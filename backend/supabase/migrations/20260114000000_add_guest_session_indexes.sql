-- Add performance indexes for guest sessions
CREATE INDEX IF NOT EXISTS idx_au_documents_guest_session_id ON au_documents(guest_session_id);
CREATE INDEX IF NOT EXISTS idx_au_upload_jobs_guest_session_id ON au_upload_jobs(guest_session_id);
CREATE INDEX IF NOT EXISTS idx_au_sessions_guest_session_id ON au_sessions(guest_session_id);
