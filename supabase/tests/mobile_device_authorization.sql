-- Run only against the local test database after the migration chain is loaded.
begin;

insert into auth.users (id, email) values
  ('e359d7ee-581c-4e9a-8ad1-1312ee6d7111', 'mobile-auth-one@example.test'),
  ('e359d7ee-581c-4e9a-8ad1-1312ee6d7222', 'mobile-auth-two@example.test');

set local role service_role;

do $$
declare
  v_first uuid := 'e359d7ee-581c-4e9a-8ad1-1312ee6d7111';
  v_second uuid := 'e359d7ee-581c-4e9a-8ad1-1312ee6d7222';
  v_request text := repeat('a', 64);
  v_cancel text := repeat('b', 64);
  v_deny text := repeat('c', 64);
  v_expired text := repeat('d', 64);
  v_same_account text := repeat('e', 64);
  v_pairing_limit text := repeat('f', 64);
  v_challenge text := repeat('V', 43);
  v_wrong_challenge text := repeat('W', 43);
  v_pairing text := repeat('1', 64);
  v_wrong_pairing text := repeat('2', 64);
  v_result jsonb;
begin
  if has_table_privilege('anon', 'public.au_mobile_device_authorizations', 'SELECT')
    or has_table_privilege('authenticated', 'public.au_mobile_device_authorizations', 'UPDATE')
    or has_function_privilege('anon', 'public.au_mobile_device_auth_device(text,text,text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.au_mobile_device_auth_decide(text,text,uuid,text)', 'EXECUTE') then
    raise exception 'Public roles must not access mobile authorization records or transitions';
  end if;

  if public.au_mobile_device_auth_create(v_request, v_challenge, v_pairing) <= clock_timestamp() then
    raise exception 'New request must expire in the future';
  end if;
  v_result := public.au_mobile_device_auth_device(v_request, v_challenge, 'consume');
  if v_result is distinct from '{"status":"pending"}'::jsonb then
    raise exception 'A verifier alone must not consume a pending request';
  end if;
  if public.au_mobile_device_auth_decide(v_request, v_wrong_pairing, v_first, 'approved') is not null then
    raise exception 'Wrong pairing proof must not approve a request';
  end if;
  if public.au_mobile_device_auth_decide(v_request, v_pairing, v_first, 'approved') is distinct from 'approved' then
    raise exception 'Correct pairing proof must approve the request';
  end if;
  if public.au_mobile_device_auth_decide(v_request, v_pairing, v_second, 'approved') is not null then
    raise exception 'A second browser identity must not replace an approval';
  end if;
  if public.au_mobile_device_auth_device(v_request, v_wrong_challenge, 'status') is not null
    or public.au_mobile_device_auth_device(v_request, v_wrong_challenge, 'consume') is not null
    or public.au_mobile_device_auth_device(v_request, v_wrong_challenge, 'cancel') is not null then
    raise exception 'Only the original device proof may read or change its request';
  end if;
  v_result := public.au_mobile_device_auth_device(v_request, v_challenge, 'status');
  if v_result is distinct from '{"status":"approved"}'::jsonb then
    raise exception 'Polling must discover browser approval without the callback';
  end if;
  v_result := public.au_mobile_device_auth_device(v_request, v_challenge, 'consume');
  if v_result is distinct from jsonb_build_object('status', 'consumed', 'userId', v_first) then
    raise exception 'The first consume must bind the approved user';
  end if;
  v_result := public.au_mobile_device_auth_device(v_request, v_challenge, 'consume');
  if v_result is distinct from '{"status":"consumed"}'::jsonb then
    raise exception 'A replay must not mint another session';
  end if;

  perform public.au_mobile_device_auth_create(v_same_account, v_challenge, v_pairing);
  perform public.au_mobile_device_auth_decide(v_same_account, v_pairing, v_first, 'approved');
  v_result := public.au_mobile_device_auth_device(v_same_account, v_challenge, 'consume');
  if v_result is distinct from '{"status":"approved"}'::jsonb then
    raise exception 'Concurrent requests for one account must wait for the first token exchange';
  end if;
  perform public.au_mobile_device_auth_release_mint(v_first, v_request);
  v_result := public.au_mobile_device_auth_device(v_same_account, v_challenge, 'consume');
  if v_result is distinct from jsonb_build_object('status', 'consumed', 'userId', v_first) then
    raise exception 'The waiting transaction must become consumable after the first finishes';
  end if;

  perform public.au_mobile_device_auth_create(v_cancel, v_challenge, v_pairing);
  perform public.au_mobile_device_auth_decide(v_cancel, v_pairing, v_second, 'approved');
  v_result := public.au_mobile_device_auth_device(v_cancel, v_challenge, 'cancel');
  if v_result is distinct from '{"status":"cancelled"}'::jsonb
    or public.au_mobile_device_auth_device(v_cancel, v_challenge, 'consume') is distinct from v_result
    or public.au_mobile_device_auth_decide(v_cancel, v_pairing, v_second, 'approved') is not null then
    raise exception 'Cancellation must be terminal';
  end if;

  perform public.au_mobile_device_auth_create(v_deny, v_challenge, v_pairing);
  if public.au_mobile_device_auth_decide(v_deny, v_pairing, v_second, 'denied') is distinct from 'denied'
    or public.au_mobile_device_auth_device(v_deny, v_challenge, 'consume') is distinct from '{"status":"denied"}'::jsonb then
    raise exception 'A browser denial must prevent consumption';
  end if;

  perform public.au_mobile_device_auth_create(v_expired, v_challenge, v_pairing);
  perform public.au_mobile_device_auth_decide(v_expired, v_pairing, v_second, 'approved');
  update public.au_mobile_device_authorizations
    set created_at = created_at - interval '6 minutes', expires_at = expires_at - interval '6 minutes'
    where request_hash = v_expired;
  if public.au_mobile_device_auth_device(v_expired, v_challenge, 'consume') is distinct from '{"status":"expired"}'::jsonb
    or public.au_mobile_device_auth_decide(v_expired, v_pairing, v_second, 'approved') is not null then
    raise exception 'An expired approval must never be consumed or reused';
  end if;

  perform public.au_mobile_device_auth_create(v_pairing_limit, v_challenge, v_pairing);
  for i in 1..8 loop
    perform public.au_mobile_device_auth_decide(v_pairing_limit, v_wrong_pairing, v_first, 'approved');
  end loop;
  if public.au_mobile_device_auth_decide(v_pairing_limit, v_pairing, v_first, 'approved') is not null then
    raise exception 'A request must enforce the pairing attempt budget';
  end if;
  for i in 1..20 loop
    if public.au_mobile_device_auth_limit('create-ip', v_request) is distinct from true then
      raise exception 'Valid rate-limited requests should fit within the window';
    end if;
  end loop;
  if public.au_mobile_device_auth_limit('create-ip', v_request) is distinct from false then
    raise exception 'The durable rate limit must reject excess requests';
  end if;
end;
$$;

rollback;
