-- Advanced User Monitoring and Messaging
-- 1. Update User Activity and Guest Sessions with device info
ALTER TABLE au_user_activity ADD COLUMN IF NOT EXISTS user_agent TEXT;
ALTER TABLE au_user_activity ADD COLUMN IF NOT EXISTS device_info JSONB DEFAULT '{}'::jsonb;
ALTER TABLE au_user_activity ADD COLUMN IF NOT EXISTS is_pwa BOOLEAN DEFAULT false;

ALTER TABLE au_guest_sessions ADD COLUMN IF NOT EXISTS user_agent TEXT;
ALTER TABLE au_guest_sessions ADD COLUMN IF NOT EXISTS device_info JSONB DEFAULT '{}'::jsonb;
ALTER TABLE au_guest_sessions ADD COLUMN IF NOT EXISTS is_pwa BOOLEAN DEFAULT false;

-- 2. Individual User Notifications Table
CREATE TABLE IF NOT EXISTS au_user_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    guest_session_id UUID REFERENCES au_guest_sessions(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now(),
    expires_at TIMESTAMPTZ,
    
    -- Ensure either user_id or guest_session_id is present
    CONSTRAINT user_or_guest CHECK (user_id IS NOT NULL OR guest_session_id IS NOT NULL)
);

-- Enable Realtime for notifications
ALTER PUBLICATION supabase_realtime ADD TABLE au_user_notifications;

-- RLS (Disabled per project convention for AU tables)
ALTER TABLE au_user_notifications DISABLE ROW LEVEL SECURITY;

-- Indexing
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON au_user_notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_guest_id ON au_user_notifications(guest_session_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON au_user_notifications(created_at DESC);

-- Notify schema reload
NOTIFY pgrst, 'reload schema';
