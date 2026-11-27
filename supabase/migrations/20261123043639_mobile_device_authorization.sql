-- Device requests hold proofs and approval state. Supabase session credentials
-- are minted after the winning consumption and never persisted here.
create table public.au_mobile_device_authorizations (
  request_hash text primary key check (request_hash ~ '^[0-9a-f]{64}$'),
  challenge text not null check (challenge ~ '^[A-Za-z0-9_-]{43}$'),
  pairing_hash text not null check (pairing_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'consumed', 'denied', 'expired', 'cancelled')),
  approved_user_id uuid references auth.users(id) on delete cascade,
  incorrect_pairing_attempts integer not null default 0 check (incorrect_pairing_attempts between 0 and 8),
  created_at timestamptz not null,
  expires_at timestamptz not null,
  check (expires_at = created_at + interval '5 minutes'),
  check ((status in ('approved', 'consumed')) = (approved_user_id is not null))
);

create index au_mobile_device_authorizations_expiry_idx
  on public.au_mobile_device_authorizations (expires_at);

create table public.au_mobile_device_auth_limits (
  scope text not null,
  subject_hash text not null check (subject_hash ~ '^[0-9a-f]{64}$'),
  window_start timestamptz not null,
  hits integer not null check (hits > 0),
  primary key (scope, subject_hash)
);

create index au_mobile_device_auth_limits_window_idx
  on public.au_mobile_device_auth_limits (window_start);

-- Auth stores the current magic-link token per account. Serialize the short
-- issue/redeem sequence across simultaneous approvals for the same account.
create table public.au_mobile_device_auth_mint_leases (
  user_id uuid primary key references auth.users(id) on delete cascade,
  request_hash text not null references public.au_mobile_device_authorizations(request_hash) on delete cascade,
  expires_at timestamptz not null
);

alter table public.au_mobile_device_authorizations enable row level security;
alter table public.au_mobile_device_auth_limits enable row level security;
alter table public.au_mobile_device_auth_mint_leases enable row level security;

revoke all on public.au_mobile_device_authorizations, public.au_mobile_device_auth_limits,
  public.au_mobile_device_auth_mint_leases from public, anon, authenticated;
grant select, insert, update, delete on public.au_mobile_device_authorizations,
  public.au_mobile_device_auth_limits, public.au_mobile_device_auth_mint_leases to service_role;

create function public.au_mobile_device_auth_limit(p_scope text, p_subject_hash text)
returns boolean
language plpgsql security invoker set search_path = ''
as $$
declare
  v_limit integer;
  v_duration interval;
  v_window timestamptz;
  v_allowed boolean;
begin
  case p_scope
    when 'create-global' then v_limit := 600; v_duration := interval '1 minute';
    when 'create-ip' then v_limit := 20; v_duration := interval '5 minutes';
    when 'browser-ip' then v_limit := 60; v_duration := interval '5 minutes';
    when 'browser-account' then v_limit := 24; v_duration := interval '5 minutes';
    when 'device-ip' then v_limit := 300; v_duration := interval '1 minute';
    else return false;
  end case;

  v_window := date_bin(v_duration, clock_timestamp(), '2020-01-01T00:00:00Z'::timestamptz);
  insert into public.au_mobile_device_auth_limits as existing (scope, subject_hash, window_start, hits)
  values (p_scope, p_subject_hash, v_window, 1)
  on conflict (scope, subject_hash) do update
    set window_start = excluded.window_start,
        hits = case when existing.window_start = excluded.window_start then existing.hits + 1 else 1 end
  where existing.window_start < excluded.window_start
     or (existing.window_start = excluded.window_start and existing.hits < v_limit)
  returning true into v_allowed;
  return coalesce(v_allowed, false);
end;
$$;

create function public.au_mobile_device_auth_create(p_request_hash text, p_challenge text, p_pairing_hash text)
returns timestamptz
language plpgsql security invoker set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_expiry timestamptz := v_now + interval '5 minutes';
begin
  -- Keep a short terminal-state window for devices that were offline and bound
  -- opportunistic cleanup so it never delays a new request substantially.
  delete from public.au_mobile_device_authorizations
    where request_hash in (
      select request_hash from public.au_mobile_device_authorizations
      where expires_at < v_now - interval '1 hour'
      order by expires_at limit 100 for update skip locked
    );
  delete from public.au_mobile_device_auth_limits
    where (scope, subject_hash) in (
      select scope, subject_hash from public.au_mobile_device_auth_limits
      where window_start < v_now - interval '1 hour'
      order by window_start limit 100 for update skip locked
    );
  insert into public.au_mobile_device_authorizations
    (request_hash, challenge, pairing_hash, created_at, expires_at)
    values (p_request_hash, p_challenge, p_pairing_hash, v_now, v_expiry);
  return v_expiry;
end;
$$;

create function public.au_mobile_device_auth_decide(
  p_request_hash text, p_pairing_hash text, p_user_id uuid, p_decision text
)
returns text
language plpgsql security invoker set search_path = ''
as $$
declare
  v_request public.au_mobile_device_authorizations%rowtype;
begin
  if p_decision is null or p_decision not in ('approved', 'denied') or p_user_id is null then
    return null;
  end if;
  select * into v_request from public.au_mobile_device_authorizations
    where request_hash = p_request_hash for update;
  if not found or v_request.status <> 'pending' or v_request.incorrect_pairing_attempts >= 8 then
    return null;
  end if;
  if v_request.expires_at <= clock_timestamp() then
    update public.au_mobile_device_authorizations set status = 'expired' where request_hash = p_request_hash;
    return null;
  end if;
  if v_request.pairing_hash is distinct from p_pairing_hash then
    update public.au_mobile_device_authorizations
      set incorrect_pairing_attempts = incorrect_pairing_attempts + 1 where request_hash = p_request_hash;
    return null;
  end if;
  update public.au_mobile_device_authorizations
    set status = p_decision,
        approved_user_id = case when p_decision = 'approved' then p_user_id else null end
    where request_hash = p_request_hash;
  return p_decision;
end;
$$;

create function public.au_mobile_device_auth_device(p_request_hash text, p_challenge text, p_action text)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_request public.au_mobile_device_authorizations%rowtype;
  v_now timestamptz;
  v_leased boolean;
begin
  if p_action is null or p_action not in ('status', 'consume', 'cancel') then
    return null;
  end if;
  select * into v_request from public.au_mobile_device_authorizations
    where request_hash = p_request_hash and challenge = p_challenge for update;
  if not found then
    return null;
  end if;
  v_now := clock_timestamp();
  if v_request.status in ('pending', 'approved') then
    if v_request.expires_at <= v_now then
      v_request.status := 'expired';
    elsif p_action = 'cancel' then
      v_request.status := 'cancelled';
    end if;
    if v_request.status in ('expired', 'cancelled') then
      update public.au_mobile_device_authorizations set status = v_request.status, approved_user_id = null
        where request_hash = p_request_hash;
    end if;
  end if;
  if p_action = 'consume' and v_request.status = 'approved' then
    insert into public.au_mobile_device_auth_mint_leases as existing (user_id, request_hash, expires_at)
      values (v_request.approved_user_id, p_request_hash, v_now + interval '30 seconds')
      on conflict (user_id) do update
      set request_hash = excluded.request_hash, expires_at = excluded.expires_at
      where existing.expires_at <= v_now
      returning true into v_leased;
    if v_leased then
      update public.au_mobile_device_authorizations set status = 'consumed'
        where request_hash = p_request_hash and expires_at > clock_timestamp();
      if found then
        return jsonb_build_object('status', 'consumed', 'userId', v_request.approved_user_id);
      end if;
      delete from public.au_mobile_device_auth_mint_leases
        where user_id = v_request.approved_user_id and request_hash = p_request_hash;
      update public.au_mobile_device_authorizations set status = 'expired', approved_user_id = null
        where request_hash = p_request_hash;
      return jsonb_build_object('status', 'expired');
    end if;
  end if;
  return jsonb_build_object('status', v_request.status);
end;
$$;

create function public.au_mobile_device_auth_release_mint(p_user_id uuid, p_request_hash text)
returns void
language sql security invoker set search_path = ''
as $$
  delete from public.au_mobile_device_auth_mint_leases
    where user_id = p_user_id and request_hash = p_request_hash;
$$;

revoke execute on function public.au_mobile_device_auth_limit(text, text),
  public.au_mobile_device_auth_create(text, text, text), public.au_mobile_device_auth_decide(text, text, uuid, text),
  public.au_mobile_device_auth_device(text, text, text), public.au_mobile_device_auth_release_mint(uuid, text)
  from public, anon, authenticated;
grant execute on function public.au_mobile_device_auth_limit(text, text),
  public.au_mobile_device_auth_create(text, text, text), public.au_mobile_device_auth_decide(text, text, uuid, text),
  public.au_mobile_device_auth_device(text, text, text), public.au_mobile_device_auth_release_mint(uuid, text)
  to service_role;
