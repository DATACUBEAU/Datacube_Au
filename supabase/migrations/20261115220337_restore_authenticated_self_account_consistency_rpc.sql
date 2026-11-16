-- The account-consistency helper is self-scoped through auth.uid().
-- Keep it available to authenticated users while blocking anonymous execution.
DO $$
BEGIN
  IF to_regprocedure('public.ensure_user_consistency()') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL PRIVILEGES ON FUNCTION public.ensure_user_consistency() FROM PUBLIC, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.ensure_user_consistency() TO authenticated';
  END IF;
  IF to_regprocedure('public.decide_auth_executor(uuid)') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.decide_auth_executor(uuid) TO service_role';
  END IF;
END;
$$;
