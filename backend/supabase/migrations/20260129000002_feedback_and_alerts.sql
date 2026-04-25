-- Migration: Feedback and Email Alerts System
-- 20260129000002_feedback_and_alerts.sql

-- 1. Feedback Table
CREATE TABLE IF NOT EXISTS au_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    guest_session_id UUID REFERENCES au_guest_sessions(id) ON DELETE SET NULL,
    section TEXT NOT NULL, -- e.g., 'chat', 'predictions', 'practice'
    rating TEXT NOT NULL, -- 'positive' or 'negative'
    comment TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feedback_section ON au_feedback(section);
CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON au_feedback(created_at DESC);

-- 2. Admin Email Alerts Configuration Table
CREATE TABLE IF NOT EXISTS au_admin_email_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type TEXT NOT NULL UNIQUE, -- 'admin_login_failed', 'critical_error', 'rate_limit_hit'
    recipients TEXT[] NOT NULL, -- Array of email addresses
    is_enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Seed initial email alert configurations
INSERT INTO au_admin_email_alerts (event_type, recipients) VALUES
('admin_login_failed', ARRAY['admin@datacube.au']),
('critical_error', ARRAY['admin@datacube.au']),
('rate_limit_hit', ARRAY['admin@datacube.au'])
ON CONFLICT (event_type) DO NOTHING;

-- 3. RLS Policies (Only service_role can access these tables)
ALTER TABLE au_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE au_admin_email_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin access only" ON au_feedback FOR ALL USING (false);
CREATE POLICY "Admin access only" ON au_admin_email_alerts FOR ALL USING (false);

-- 4. Public Insert for Feedback (Allowing users to submit feedback)
CREATE POLICY "Anyone can insert feedback" ON au_feedback FOR INSERT WITH CHECK (true);
