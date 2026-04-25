-- Migration: User Monitoring and Direct Messaging
-- 20260130000004_user_monitoring_and_dm.sql

-- 1. Add metadata column to activity tracking tables
ALTER TABLE au_user_activity ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
ALTER TABLE au_guest_sessions ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

-- 2. Create Direct Messaging table
CREATE TABLE IF NOT EXISTS au_direct_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    guest_session_id UUID REFERENCES au_guest_sessions(id) ON DELETE CASCADE,
    sender_type TEXT NOT NULL CHECK (sender_type IN ('admin', 'system')),
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now(),
    
    -- Ensure either user_id or guest_session_id is present
    CONSTRAINT dm_target CHECK (user_id IS NOT NULL OR guest_session_id IS NOT NULL)
);

-- Enable Realtime for direct messages
ALTER PUBLICATION supabase_realtime ADD TABLE au_direct_messages;

-- RLS (Disabled per project convention for AU tables)
ALTER TABLE au_direct_messages DISABLE ROW LEVEL SECURITY;

-- Indexing
CREATE INDEX IF NOT EXISTS idx_dm_user_id ON au_direct_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_dm_guest_id ON au_direct_messages(guest_session_id);
CREATE INDEX IF NOT EXISTS idx_dm_created_at ON au_direct_messages(created_at DESC);

-- 3. Create a robust schema reload function
CREATE OR REPLACE FUNCTION reload_schema_cache()
RETURNS void AS $$
BEGIN
  NOTIFY pgrst, 'reload schema';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger immediate reload
SELECT reload_schema_cache();
