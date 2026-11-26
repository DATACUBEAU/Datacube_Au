-- Restrict authenticated-only and server-only policies to their intended roles.
-- Do not change application data or remove backend processing tables.
-- The browser product is retired, but the native application and Conex remain supported.

-- Activity analytics may submit events without a user_id. When a user_id is supplied,
-- it must belong to the caller. Service-role account deletion remains unaffected.
DROP POLICY IF EXISTS "Users can insert own activity" ON public.au_activity_log;
CREATE POLICY "Users can insert own activity"
  ON public.au_activity_log
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id IS NULL OR user_id = (select auth.uid()));

-- Conex configuration is not public. It can be read by signed-in clients that
-- need its public configuration values; writes remain restricted to admins.
ALTER POLICY "Admins can update conex config"
  ON public.au_conex_config
  TO authenticated;
ALTER POLICY "Authenticated users can read conex config"
  ON public.au_conex_config
  TO authenticated;

-- au_config contains banking details, price identifiers and alert configuration.
-- Current callers use the service-role Admin API, so remove anonymous/public reads.
DROP POLICY IF EXISTS "Allow read for everyone" ON public.au_config;

-- au_model_routing is an unused legacy/admin registry table. Keep any admin/server
-- access on service_role only; the active runtime resolver reads au_models_registry.
ALTER POLICY "Allow read for everyone model routing"
  ON public.au_model_routing
  TO service_role;
