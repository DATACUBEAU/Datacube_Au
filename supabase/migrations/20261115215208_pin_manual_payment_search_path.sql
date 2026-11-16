DO $$
BEGIN
  IF to_regprocedure('public.approve_manual_payment(uuid,uuid,text)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.approve_manual_payment(uuid, uuid, text) SET search_path = pg_catalog, public';
  END IF;
END;
$$;
