
-- 1. Feature Flags Table
CREATE TABLE IF NOT EXISTS au_feature_flags (
    key TEXT PRIMARY KEY,
    is_enabled BOOLEAN DEFAULT false,
    value_json JSONB DEFAULT '{}'::jsonb,
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Insert default flag for Pro Upload
INSERT INTO au_feature_flags (key, is_enabled, description)
VALUES ('pro_upload_100mb', false, 'Allow Pro users to upload up to 100MB')
ON CONFLICT (key) DO NOTHING;

-- RLS for Flags
ALTER TABLE au_feature_flags ENABLE ROW LEVEL SECURITY;

-- Allow everyone to read flags (needed for frontend UI limits)
CREATE POLICY "Allow public read of flags" ON au_feature_flags FOR SELECT USING (true);

-- 2. Deletion Log (For Async Cleanup of Qdrant/Storage)
CREATE TABLE IF NOT EXISTS au_deletion_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL, -- Keep ID even if doc is gone
    owner_id UUID,             -- For Qdrant filter
    file_path TEXT,            -- For Storage cleanup redundancy
    deleted_at TIMESTAMPTZ DEFAULT now(),
    processed BOOLEAN DEFAULT false,
    processed_at TIMESTAMPTZ
);

-- Index for worker polling
CREATE INDEX IF NOT EXISTS idx_deletion_log_processed ON au_deletion_log(processed);

-- 3. Trigger to log deletions
CREATE OR REPLACE FUNCTION log_document_deletion()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO au_deletion_log (document_id, owner_id, file_path)
    VALUES (OLD.id, OLD.owner_id, OLD.file_path);
    RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_document_delete_log ON au_documents;
CREATE TRIGGER on_document_delete_log
AFTER DELETE ON au_documents
FOR EACH ROW EXECUTE FUNCTION log_document_deletion();

-- 4. Ensure expires_at is indexed for Retention Worker
CREATE INDEX IF NOT EXISTS idx_documents_expires_at ON au_documents(expires_at);
