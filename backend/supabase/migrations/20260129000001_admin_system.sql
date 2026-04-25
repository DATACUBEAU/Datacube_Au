-- Migration: Admin System (Conex)
-- 20260129000001_admin_system.sql

-- 1. Admin Configuration Table
CREATE TABLE IF NOT EXISTS au_admin_config (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Seed initial admin config
INSERT INTO au_admin_config (key, value, description) VALUES
('challenge_question', '"Who are you now?"', 'The first step challenge question'),
('challenge_answer', '"nobody worth knowing 121##"', 'The correct answer to the first step challenge'),
('admin_access_key', '"cruzanX121#data#AU!"', 'The second step access key')
ON CONFLICT (key) DO NOTHING;

-- 2. Admin Sessions & Blocking Table
CREATE TABLE IF NOT EXISTS au_admin_sessions (
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

CREATE INDEX IF NOT EXISTS idx_admin_sessions_ip ON au_admin_sessions(ip_address);

-- 3. Broadcast Messages Table
CREATE TABLE IF NOT EXISTS au_broadcast_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable Realtime for broadcasts
ALTER PUBLICATION supabase_realtime ADD TABLE au_broadcast_messages;

-- 4. Key Groups Table (Dynamic Registry)
CREATE TABLE IF NOT EXISTS au_key_groups (
    id SERIAL PRIMARY KEY,
    api_key TEXT NOT NULL,
    models TEXT[] NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- RLS Policies (Only service_role can access these tables)
ALTER TABLE au_admin_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE au_admin_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE au_broadcast_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE au_key_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin access only" ON au_admin_config FOR ALL USING (false);
CREATE POLICY "Admin access only" ON au_admin_sessions FOR ALL USING (false);
CREATE POLICY "Public read broadcasts" ON au_broadcast_messages FOR SELECT USING (expires_at IS NULL OR expires_at > now());
CREATE POLICY "Admin access only" ON au_broadcast_messages FOR INSERT WITH CHECK (false);
CREATE POLICY "Admin access only" ON au_key_groups FOR ALL USING (false);
