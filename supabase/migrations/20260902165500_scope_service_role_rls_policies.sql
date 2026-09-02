BEGIN;

-- Historical migrations recreated several policies named for the service role
-- without an explicit role target. In PostgreSQL a policy without TO applies
-- to PUBLIC, so a permissive USING (TRUE) policy can defeat otherwise
-- tenant-scoped RLS whenever anon/authenticated have table privileges.
-- Harden the final schema without rewriting migration history.

DROP POLICY IF EXISTS "Service role full access conex config" ON public.au_conex_config;
CREATE POLICY "Service role full access conex config"
  ON public.au_conex_config
  FOR ALL
  TO service_role
  USING (TRUE)
  WITH CHECK (TRUE);

DROP POLICY IF EXISTS "Service role only stripe events" ON public.au_stripe_events;
CREATE POLICY "Service role only stripe events"
  ON public.au_stripe_events
  FOR ALL
  TO service_role
  USING (TRUE)
  WITH CHECK (TRUE);

DROP POLICY IF EXISTS "Service role can manage events" ON public.au_events;
CREATE POLICY "Service role can manage events"
  ON public.au_events
  FOR ALL
  TO service_role
  USING (TRUE)
  WITH CHECK (TRUE);

NOTIFY pgrst, 'reload schema';

COMMIT;
