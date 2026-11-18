-- Scope service-role policies to service_role instead of PUBLIC.
-- Three prior policies used USING (true) for PUBLIC and exposed privileged tables
-- to anonymous/authenticated clients. This migration changes policy roles only;
-- no application data is modified.

DROP POLICY IF EXISTS "Service role full access" ON public.admin_access_logs;
CREATE POLICY "Service role full access"
  ON public.admin_access_logs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access activity" ON public.au_activity_log;
CREATE POLICY "Service role full access activity"
  ON public.au_activity_log
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DO $$
BEGIN
  IF to_regclass('public.au_auth_mappings') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "Service role can manage all auth mappings" ON public.au_auth_mappings';
    EXECUTE 'CREATE POLICY "Service role can manage all auth mappings"
      ON public.au_auth_mappings
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true)';
  END IF;
END
$$;

DROP POLICY IF EXISTS "Service role full access conex config" ON public.au_conex_config;
CREATE POLICY "Service role full access conex config"
  ON public.au_conex_config
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service role can insert config" ON public.au_config;
CREATE POLICY "Service role can insert config"
  ON public.au_config
  FOR INSERT
  TO service_role
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service role can update config" ON public.au_config;
CREATE POLICY "Service role can update config"
  ON public.au_config
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service role can manage events" ON public.au_events;
CREATE POLICY "Service role can manage events"
  ON public.au_events
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
