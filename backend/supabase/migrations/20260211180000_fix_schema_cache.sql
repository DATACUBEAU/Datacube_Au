
-- Ensure Guest Sessions table exists (Idempotent fix)
CREATE TABLE IF NOT EXISTS au_guest_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ DEFAULT (now() + interval '24 hours')
);

-- Force Schema Cache Reload
NOTIFY pgrst, 'reload config';
