
-- Make the 'documents' bucket public
UPDATE storage.buckets
SET public = true
WHERE id = 'documents';

-- Ensure the policy allows public access if needed (optional, but good for "public" buckets)
-- However, for RAG, we usually want restricted access.
-- If the user insists on public, we allow public reads.

DROP POLICY IF EXISTS "Public Access to Documents" ON storage.objects;

CREATE POLICY "Public Access to Documents"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'documents');
