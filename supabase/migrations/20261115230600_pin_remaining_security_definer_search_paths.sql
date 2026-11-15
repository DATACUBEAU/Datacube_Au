-- Pin the remaining SECURITY DEFINER functions whose search_path was mutable.
ALTER FUNCTION public.au_rate_limit_hit(text, uuid, text, text, timestamptz, integer)
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.cleanup_inactive_accounts()
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.decide_auth_executor(uuid)
  SET search_path = pg_catalog, public;
