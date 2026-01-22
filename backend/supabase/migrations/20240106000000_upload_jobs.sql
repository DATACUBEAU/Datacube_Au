-- Phase 6: Upload Jobs (Supabase-native)

CREATE TABLE IF NOT EXISTS au_upload_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users NOT NULL,
  document_id UUID REFERENCES au_documents(id) ON DELETE CASCADE NOT NULL,
  label TEXT,
  file_name TEXT NOT NULL,
  mime_type TEXT,
  file_size_bytes BIGINT NOT NULL,
  bucket TEXT NOT NULL DEFAULT 'documents',
  object_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','uploading','uploaded','processing','done','failed','cancelled')),
  progress INT NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  tus_url TEXT,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS au_upload_jobs_user_id_idx ON au_upload_jobs(user_id);
CREATE INDEX IF NOT EXISTS au_upload_jobs_status_idx ON au_upload_jobs(status);

ALTER TABLE au_upload_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own upload jobs" ON au_upload_jobs;
DROP POLICY IF EXISTS "Users can insert own upload jobs" ON au_upload_jobs;
DROP POLICY IF EXISTS "Users can update own upload jobs" ON au_upload_jobs;
DROP POLICY IF EXISTS "Users can delete own upload jobs" ON au_upload_jobs;

CREATE POLICY "Users can view own upload jobs" ON au_upload_jobs
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own upload jobs" ON au_upload_jobs
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own upload jobs" ON au_upload_jobs
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own upload jobs" ON au_upload_jobs
  FOR DELETE USING (auth.uid() = user_id);
