-- Migration: Admin System (Conex)
-- 20260129000001_admin_system.sql
--
-- Security note:
-- Historical credential seed values were removed from this migration. Admin
-- challenge answers and access keys must be configured through server-side
-- environment variables or a dedicated encrypted secret-management flow.

CREATE TABLE IF NOT EXISTS public.au_admin_config (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO public.au_admin_config (key, value, description) VALUES
('challenge_question', to_jsonb('Configure the admin challenge server-side'::text), 'Admin challenge prompt placeholder'),
('challenge_answer', to_jsonb('REDACTED_CONFIGURE_SERVER_ENV_ONLY'::text), 'Placeholder only; rotate and configure outside tracked SQL'),
('admin_access_key', to_jsonb('REDACTED_CONFIGURE_SERVER_ENV_ONLY'::text), 'Placeholder only; rotate and configure outside tracked SQL')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.au_admin_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ip_address TEXT,
    user_agent TEXT,
    failed_attempts_step1 INT DEFAULT 0,
    failed_attempts_step2 INT DEFAULT 0,
    blocked_until TIMESTAMPTZ,
    is_authenticated BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_ip ON public.au_admin_sessions(ip_address);

CREATE TABLE IF NOT EXISTS public.au_broadcast_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.au_broadcast_messages;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE IF NOT EXISTS public.au_key_groups (
    id SERIAL PRIMARY KEY,
    api_key TEXT,
    models TEXT[] NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.au_admin_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.au_admin_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.au_broadcast_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.au_key_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin access only" ON public.au_admin_config;
CREATE POLICY "Admin access only" ON public.au_admin_config FOR ALL USING (false);

DROP POLICY IF EXISTS "Admin access only" ON public.au_admin_sessions;
CREATE POLICY "Admin access only" ON public.au_admin_sessions FOR ALL USING (false);

DROP POLICY IF EXISTS "Public read broadcasts" ON public.au_broadcast_messages;
CREATE POLICY "Public read broadcasts" ON public.au_broadcast_messages
  FOR SELECT USING (expires_at IS NULL OR expires_at > now());

DROP POLICY IF EXISTS "Admin access only" ON public.au_broadcast_messages;
CREATE POLICY "Admin access only" ON public.au_broadcast_messages FOR INSERT WITH CHECK (false);

DROP POLICY IF EXISTS "Admin access only" ON public.au_key_groups;
CREATE POLICY "Admin access only" ON public.au_key_groups FOR ALL USING (false);
