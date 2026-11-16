-- These authenticated telemetry functions enforce auth.uid() ownership internally.
-- Do not expose them to anonymous callers; retain authenticated and service-role use.
REVOKE ALL PRIVILEGES ON FUNCTION public.record_user_activity(uuid,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_user_activity(uuid,text,jsonb) TO authenticated, service_role;

REVOKE ALL PRIVILEGES ON FUNCTION public.track_usage_event(uuid,text,text,text,jsonb,text,text,jsonb,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.track_usage_event(uuid,text,text,text,jsonb,text,text,jsonb,timestamptz) TO authenticated, service_role;
