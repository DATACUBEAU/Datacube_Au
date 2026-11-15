-- Provider API key rotation is a backend-only operation.
-- The function reads from au_api_keys, which contains provider credentials.
-- Restrict invocation to service_role; retain the service-side API used by Edge Functions.
revoke execute on function public.get_rotated_api_key(text) from public, anon, authenticated;
grant execute on function public.get_rotated_api_key(text) to service_role;
