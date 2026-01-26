-- Add metadata column to user activity and guest sessions for global UI state
ALTER TABLE au_user_activity ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
ALTER TABLE au_guest_sessions ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

-- Ensure RLS is updated if needed (it should be fine since existing policies allow update)
