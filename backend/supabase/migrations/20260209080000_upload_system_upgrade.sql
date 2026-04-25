
ALTER TABLE au_documents ADD COLUMN IF NOT EXISTS storage_deleted_at TIMESTAMPTZ;
ALTER TABLE au_documents ADD COLUMN IF NOT EXISTS cleanup_reason TEXT;

-- Ensure file_size_bytes is in au_worker_jobs if not already (it was added in previous migration but good to double check or ignore)
-- It's better to trust previous knowledge that it exists.

-- Index for cleanup query
CREATE INDEX IF NOT EXISTS idx_documents_cleanup ON au_documents(status, created_at) WHERE storage_deleted_at IS NULL;

-- Index for retention query (optional, Qdrant handles vector retention, but if we want to delete from DB too)
CREATE INDEX IF NOT EXISTS idx_documents_expires_at ON au_documents(expires_at);
