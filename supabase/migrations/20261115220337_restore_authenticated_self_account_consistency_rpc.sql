-- The account-consistency helper is intentionally self-scoped through auth.uid().
-- Keep it available to authenticated users while blocking anonymous execution.
REVOKE ALL PRIVILEGES ON FUNCTION public.ensure_user_consistency() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_user_consistency() TO authenticated;
GRANT EXECUTE ON FUNCTION public.decide_auth_executor(uuid) TO service_role;
