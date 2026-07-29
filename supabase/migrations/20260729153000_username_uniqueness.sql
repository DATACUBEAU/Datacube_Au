-- DataCube AU username uniqueness hardening.
-- Safe notes:
-- - Does not drop, truncate, or rename existing users.
-- - Existing profile rows without usernames remain null.
-- - A preflight guard raises only the duplicate group count if normalized duplicates already exist.

create or replace function public.normalize_au_username(p_username text)
returns text
language sql
immutable
as $$
  select nullif(lower(btrim(coalesce(p_username, ''))), '')
$$;

alter table public.au_user_profiles
  add column if not exists username text,
  add column if not exists username_normalized text;

update public.au_user_profiles
set
  username_normalized = public.normalize_au_username(username)
where username is not null
  and username_normalized is distinct from public.normalize_au_username(username);

do $$
declare
  v_duplicate_groups integer := 0;
begin
  select count(*)
    into v_duplicate_groups
  from (
    select public.normalize_au_username(username) as normalized_username
    from public.au_user_profiles
    where public.normalize_au_username(username) is not null
    group by public.normalize_au_username(username)
    having count(*) > 1
  ) duplicates;

  if v_duplicate_groups > 0 then
    raise exception 'username_normalized_duplicates_detected:%', v_duplicate_groups
      using
        errcode = '23505',
        detail = 'Resolve duplicate normalized username groups before applying the unique index.';
  end if;
end $$;

create unique index if not exists au_user_profiles_username_normalized_uidx
  on public.au_user_profiles (username_normalized)
  where username_normalized is not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'au_user_profiles_username_normalized_match_ck'
      and conrelid = 'public.au_user_profiles'::regclass
  ) then
    alter table public.au_user_profiles
      add constraint au_user_profiles_username_normalized_match_ck
      check (
        username_normalized is null
        or username_normalized = public.normalize_au_username(username)
      );
  end if;

end $$;

create or replace function public.set_au_user_profile_username_normalized()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.username = public.normalize_au_username(new.username);
  new.username_normalized = public.normalize_au_username(new.username);
  return new;
end;
$$;

drop trigger if exists trg_set_au_user_profile_username_normalized
  on public.au_user_profiles;
create trigger trg_set_au_user_profile_username_normalized
before insert or update of username, username_normalized on public.au_user_profiles
for each row
execute function public.set_au_user_profile_username_normalized();

create or replace function public.is_au_username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.normalize_au_username(p_username) is not null
    and not exists (
      select 1
      from public.au_user_profiles
      where username_normalized = public.normalize_au_username(p_username)
    )
$$;

grant execute on function public.is_au_username_available(text) to anon, authenticated;

create or replace function public.sync_supabase_user_to_au_users()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_username text := public.normalize_au_username(new.raw_user_meta_data->>'username');
begin
  insert into public.au_users (id, provider, provider_uid, email, created_at, updated_at)
  values (new.id, 'supabase', new.id::text, new.email, new.created_at, new.updated_at)
  on conflict (id) do update
  set email = excluded.email,
      updated_at = excluded.updated_at;

  insert into public.au_user_profiles (user_id, full_name, avatar_url, username, username_normalized, updated_at)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'avatar_url',
    v_username,
    v_username,
    now()
  )
  on conflict (user_id) do update
  set
    full_name = excluded.full_name,
    avatar_url = excluded.avatar_url,
    username = coalesce(public.au_user_profiles.username, excluded.username),
    username_normalized = coalesce(public.au_user_profiles.username_normalized, excluded.username_normalized),
    updated_at = now();

  return new;
end;
$$;

alter function public.sync_supabase_user_to_au_users() owner to postgres;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    execute 'grant usage on schema public to supabase_auth_admin';
    execute 'grant select, insert, update on table public.au_users to supabase_auth_admin';
    execute 'grant select, insert, update on table public.au_user_profiles to supabase_auth_admin';
    execute 'grant execute on function public.sync_supabase_user_to_au_users() to supabase_auth_admin';
    execute 'grant execute on function public.set_au_user_profile_username_normalized() to supabase_auth_admin';
  end if;
end $$;

notify pgrst, 'reload schema';
