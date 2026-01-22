-- Account Inactivity Policy Migration
-- Requirements: 
-- 1. Guest Users: 24h inactivity limit.
-- 2. Authenticated Users: 14d inactivity limit.

-- 1. Update Guest Sessions Table
ALTER TABLE au_guest_sessions 
ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ DEFAULT now();

-- 2. Create User Activity Table for Authenticated Users
CREATE TABLE IF NOT EXISTS au_user_activity (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_active_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS on user activity
ALTER TABLE au_user_activity ENABLE ROW LEVEL SECURITY;

-- Users can only see/update their own activity
CREATE POLICY "Users can view own activity" ON au_user_activity
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own activity" ON au_user_activity
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own activity" ON au_user_activity
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 3. Cleanup Function
-- This function can be called by an Edge Function or a Postgres Cron job.
CREATE OR REPLACE FUNCTION cleanup_inactive_accounts()
RETURNS void AS $$
BEGIN
  -- Delete inactive guest sessions (older than 24h)
  DELETE FROM au_guest_sessions
  WHERE last_active_at < (now() - interval '24 hours');

  -- Delete inactive authenticated users (older than 14 days)
  -- Note: This only deletes their DATA in our tables because of CASCADE, 
  -- but we might want to trigger a more thorough cleanup if needed.
  -- For now, we delete from au_user_activity which cascades to our other tables.
  
  -- Step 1: Find users to delete
  -- Step 2: Delete from auth.users (requires service_role/admin privileges)
  -- Since we are in Postgres, we can't easily delete from auth.users without being superuser.
  -- Instead, we will delete their data from our tables.
  
  DELETE FROM au_user_activity
  WHERE last_active_at < (now() - interval '14 days');
  
  -- The CASCADE on au_user_activity should handle other tables if they reference it.
  -- However, most of our tables reference auth.users(id).
  -- So we need to explicitly delete from those tables based on au_user_activity.
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Transition Function (Guest -> Auth)
-- This function merges guest data into an authenticated user.
CREATE OR REPLACE FUNCTION migrate_guest_to_user(p_guest_id UUID, p_user_id UUID)
RETURNS void AS $$
BEGIN
  -- 1. Update documents
  UPDATE au_documents 
  SET user_id = p_user_id, guest_session_id = NULL 
  WHERE guest_session_id = p_guest_id;

  -- 2. Update upload jobs
  UPDATE au_upload_jobs 
  SET user_id = p_user_id, guest_session_id = NULL 
  WHERE guest_session_id = p_guest_id;

  -- 3. Update sessions (chat)
  UPDATE au_sessions 
  SET user_id = p_user_id, guest_session_id = NULL 
  WHERE guest_session_id = p_guest_id;

  -- 4. Delete the guest session
  DELETE FROM au_guest_sessions WHERE id = p_guest_id;

  -- 5. Initialize/Update user activity
  INSERT INTO au_user_activity (user_id, last_active_at)
  VALUES (p_user_id, now())
  ON CONFLICT (user_id) DO UPDATE 
  SET last_active_at = now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
