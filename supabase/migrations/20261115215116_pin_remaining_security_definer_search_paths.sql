DO $$
BEGIN
  IF to_regprocedure('public.au_rate_limit_hit(text,uuid,text,text,timestamptz,integer)') IS NOT NULL THEN
    ALTER FUNCTION public.au_rate_limit_hit(text, uuid, text, text, timestamptz, integer)
      SET search_path = pg_catalog, public;
  END IF;
END;
$$;
