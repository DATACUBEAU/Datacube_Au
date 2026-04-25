
-- Ensure the 'documents' bucket exists and is public
INSERT INTO storage.buckets (id, name, public, avif_autodetection, file_size_limit, allowed_mime_types)
VALUES (
  'documents', 
  'documents', 
  TRUE, 
  FALSE, 
  52428800, -- 50MB
  ARRAY['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'text/plain']
)
ON CONFLICT (id) DO UPDATE SET
  public = TRUE,
  file_size_limit = 52428800,
  allowed_mime_types = ARRAY['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'text/plain'];

-- Only recreate policies if they don't exist, to avoid ownership issues if possible
-- Or try to drop them first. 
-- Note: 'storage.objects' is owned by 'supabase_storage_admin' usually.
-- We can only modify policies if we have permissions.
-- If this fails, we will assume policies are managed elsewhere and just focus on the bucket creation.

DO $$
BEGIN
  -- We'll try to ensure the bucket exists first. The INSERT above should handle that.
  -- Now let's try to add policies safely.
  
  -- Policy: Users can insert own documents
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'Users can insert own documents'
  ) THEN
    CREATE POLICY "Users can insert own documents" ON storage.objects
    FOR INSERT WITH CHECK (
      bucket_id = 'documents' AND
      (auth.role() = 'service_role' OR auth.uid()::text = (storage.foldername(name))[1])
    );
  END IF;

  -- Policy: Users can view own documents
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'Users can view own documents'
  ) THEN
    CREATE POLICY "Users can view own documents" ON storage.objects
    FOR SELECT USING (
      bucket_id = 'documents' AND
      (auth.role() = 'service_role' OR auth.uid()::text = (storage.foldername(name))[1])
    );
  END IF;

END
$$;
