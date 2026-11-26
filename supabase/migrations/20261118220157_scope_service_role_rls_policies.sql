-- Recovered production ledger version; original SQL archived under docs/audits/migration-ledger-originals.
-- Historical installations may lack legacy relations/policies; do not recreate retired objects.
-- Existing objects receive the same policy changes as the production ledger.
DO $p0_replay$
BEGIN
  IF to_regclass('public.admin_access_logs') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Service role full access" ON public.admin_access_logs;
  END IF;

  IF to_regclass('public.admin_access_logs') IS NOT NULL THEN
    CREATE POLICY "Service role full access"
      ON public.admin_access_logs
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;

  IF to_regclass('public.au_activity_log') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Service role full access activity" ON public.au_activity_log;
  END IF;

  IF to_regclass('public.au_activity_log') IS NOT NULL THEN
    CREATE POLICY "Service role full access activity"
      ON public.au_activity_log
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;

  IF to_regclass('public.au_auth_mappings') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Service role can manage all auth mappings" ON public.au_auth_mappings;
  END IF;

  IF to_regclass('public.au_auth_mappings') IS NOT NULL THEN
    CREATE POLICY "Service role can manage all auth mappings"
      ON public.au_auth_mappings
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;

  IF to_regclass('public.au_conex_config') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Service role full access conex config" ON public.au_conex_config;
  END IF;

  IF to_regclass('public.au_conex_config') IS NOT NULL THEN
    CREATE POLICY "Service role full access conex config"
      ON public.au_conex_config
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;

  IF to_regclass('public.au_config') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Service role can insert config" ON public.au_config;
  END IF;

  IF to_regclass('public.au_config') IS NOT NULL THEN
    CREATE POLICY "Service role can insert config"
      ON public.au_config
      FOR INSERT
      TO service_role
      WITH CHECK (true);
  END IF;

  IF to_regclass('public.au_config') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Service role can update config" ON public.au_config;
  END IF;

  IF to_regclass('public.au_config') IS NOT NULL THEN
    CREATE POLICY "Service role can update config"
      ON public.au_config
      FOR UPDATE
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;

  IF to_regclass('public.au_events') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Service role can manage events" ON public.au_events;
  END IF;

  IF to_regclass('public.au_events') IS NOT NULL THEN
    CREATE POLICY "Service role can manage events"
      ON public.au_events
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END;
$p0_replay$;
