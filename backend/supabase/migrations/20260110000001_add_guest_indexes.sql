-- Migration: Add missing guest_session_id indexes for performance
-- Date: 2026-01-10
-- Priority: MEDIUM

-- au_document_chunks guest index
CREATE INDEX IF NOT EXISTS idx_document_chunks_guest_session_id ON au_document_chunks(guest_session_id);

-- au_messages guest index
CREATE INDEX IF NOT EXISTS idx_messages_guest_session_id ON au_messages(guest_session_id);

-- au_model_usage guest index
CREATE INDEX IF NOT EXISTS idx_model_usage_guest_session_id ON au_model_usage(guest_session_id);

-- au_upload_jobs guest index
CREATE INDEX IF NOT EXISTS idx_upload_jobs_guest_session_id ON au_upload_jobs(guest_session_id);

-- au_sessions guest index
CREATE INDEX IF NOT EXISTS idx_sessions_guest_session_id ON au_sessions(guest_session_id);
