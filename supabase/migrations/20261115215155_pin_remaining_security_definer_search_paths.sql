DO $$
BEGIN
  IF to_regprocedure('public.cleanup_inactive_accounts()') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.cleanup_inactive_accounts() SET search_path = pg_catalog, public';
  END IF;
  IF to_regprocedure('public.decide_auth_executor(uuid)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.decide_auth_executor(uuid) SET search_path = pg_catalog, public';
  END IF;
END;
$$;
