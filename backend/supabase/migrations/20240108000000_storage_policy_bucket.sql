-- Phase 8: Storage Policies (bucket alignment)

INSERT INTO storage.buckets (id, name, public)
VALUES ('DataCube', 'DataCube', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Users can upload their own documents" ON storage.objects;
DROP POLICY IF EXISTS "Users can view their own documents" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own documents" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own documents" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload their own documents (DataCube)" ON storage.objects;
DROP POLICY IF EXISTS "Users can view their own documents (DataCube)" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own documents (DataCube)" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own documents (DataCube)" ON storage.objects;

CREATE POLICY "Users can upload their own documents (DataCube)"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'DataCube' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can upload their own documents"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'documents' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can view their own documents (DataCube)"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'DataCube' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can view their own documents"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'documents' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can update their own documents (DataCube)"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'DataCube' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can update their own documents"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'documents' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can delete their own documents (DataCube)"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'DataCube' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can delete their own documents"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'documents' AND
  (storage.foldername(name))[1] = auth.uid()::text
);
