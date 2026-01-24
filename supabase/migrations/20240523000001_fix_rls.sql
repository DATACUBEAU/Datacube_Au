
-- Enable RLS on au_documents
ALTER TABLE au_documents ENABLE ROW LEVEL SECURITY;

-- Policy for SELECT: Users can see their own documents OR documents belonging to their guest session
CREATE POLICY "Users can view own documents"
ON au_documents FOR SELECT
USING (
  auth.uid() = user_id 
  OR 
  (guest_session_id IS NOT NULL AND guest_session_id::text = current_setting('request.jwt.claim.guest_session_id', true))
);

-- Policy for INSERT: Users can insert documents
CREATE POLICY "Users can insert own documents"
ON au_documents FOR INSERT
WITH CHECK (
  auth.uid() = user_id 
  OR 
  (guest_session_id IS NOT NULL AND guest_session_id::text = current_setting('request.jwt.claim.guest_session_id', true))
);

-- Policy for UPDATE: Users can update own documents
CREATE POLICY "Users can update own documents"
ON au_documents FOR UPDATE
USING (
  auth.uid() = user_id 
  OR 
  (guest_session_id IS NOT NULL AND guest_session_id::text = current_setting('request.jwt.claim.guest_session_id', true))
);

-- Policy for DELETE: Users can delete own documents
CREATE POLICY "Users can delete own documents"
ON au_documents FOR DELETE
USING (
  auth.uid() = user_id 
  OR 
  (guest_session_id IS NOT NULL AND guest_session_id::text = current_setting('request.jwt.claim.guest_session_id', true))
);

-- Grant access to authenticated and anon (for guest users)
GRANT ALL ON au_documents TO authenticated;
GRANT ALL ON au_documents TO anon;
