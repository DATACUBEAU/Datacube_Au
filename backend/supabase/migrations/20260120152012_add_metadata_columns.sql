-- Add metadata columns to AU tables
ALTER TABLE au_documents ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
ALTER TABLE au_upload_jobs ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
ALTER TABLE au_guest_sessions ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

-- Ensure guest_session_id exists in au_upload_jobs
ALTER TABLE au_upload_jobs ADD COLUMN IF NOT EXISTS guest_session_id UUID REFERENCES au_guest_sessions(id) ON DELETE CASCADE;
ALTER TABLE au_upload_jobs ALTER COLUMN user_id DROP NOT NULL;
