BEGIN;

-- Historical migrations recreated several policies named for the service role
-- without an explicit role target. In PostgreSQL a policy without TO applies
-- to PUBLIC, so a permissive USING (TRUE) policy can defeat otherwise
-- tenant-scoped RLS whenever anon/authenticated have table privileges.
-- Harden the final schema without rewriting migration history.
--
-- Some historical installations do not contain every legacy table below, so
-- guard each policy repair by relation existence. Fixed dynamic SQL avoids
-- parse-time references to absent optional relations during clean rebuilds.

DO $$
BEGIN
  IF to_regclass('public.au_conex_config') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "Service role full access conex config" ON public.au_conex_config';
    EXECUTE 'CREATE POLICY "Service role full access conex config"
      ON public.au_conex_config
      FOR ALL
      TO service_role
      USING (TRUE)
      WITH CHECK (TRUE)';
  END IF;

  IF to_regclass('public.au_stripe_events') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "Service role only stripe events" ON public.au_stripe_events';
    EXECUTE 'CREATE POLICY "Service role only stripe events"
      ON public.au_stripe_events
      FOR ALL
      TO service_role
      USING (TRUE)
      WITH CHECK (TRUE)';
  END IF;

  IF to_regclass('public.au_events') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "Service role can manage events" ON public.au_events';
    EXECUTE 'CREATE POLICY "Service role can manage events"
      ON public.au_events
      FOR ALL
      TO service_role
      USING (TRUE)
      WITH CHECK (TRUE)';
  END IF;
END
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
