-- Recovered production ledger version; original SQL archived under docs/audits/migration-ledger-originals.
-- Historical installations may lack legacy relations/policies; do not recreate retired objects.
-- Existing objects receive the same policy changes as the production ledger.
DO $p0_replay$
BEGIN
  IF to_regclass('public.au_activity_log') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Users can insert own activity" ON public.au_activity_log;
  END IF;

  IF to_regclass('public.au_activity_log') IS NOT NULL THEN
    CREATE POLICY "Users can insert own activity"
      ON public.au_activity_log
      FOR INSERT
      TO authenticated
      WITH CHECK (user_id IS NULL OR user_id = (select auth.uid()));
  END IF;

  IF to_regclass('public.au_conex_config') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'au_conex_config' AND policyname = 'Admins can update conex config') THEN
    ALTER POLICY "Admins can update conex config"
      ON public.au_conex_config
      TO authenticated;
  END IF;

  IF to_regclass('public.au_conex_config') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'au_conex_config' AND policyname = 'Authenticated users can read conex config') THEN
    ALTER POLICY "Authenticated users can read conex config"
      ON public.au_conex_config
      TO authenticated;
  END IF;

  IF to_regclass('public.au_config') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Allow read for everyone" ON public.au_config;
  END IF;

  IF to_regclass('public.au_model_routing') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'au_model_routing' AND policyname = 'Allow read for everyone model routing') THEN
    ALTER POLICY "Allow read for everyone model routing"
      ON public.au_model_routing
      TO service_role;
  END IF;
END;
$p0_replay$;
