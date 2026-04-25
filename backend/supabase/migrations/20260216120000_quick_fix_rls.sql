-- QUICK FIX: Add Missing RLS Policies for au_document_chunks
-- This fixes the "Unauthorized: Cannot insert chunks" error

-- ============================================
-- INSERT policy (required for Edge Function)
-- ============================================
DROP POLICY IF EXISTS "Users can insert own chunks" ON au_document_chunks;

CREATE POLICY "Users can insert own chunks"
  ON au_document_chunks
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- ============================================
-- DELETE policy (required for Edge Function to delete old chunks)
-- ============================================
DROP POLICY IF EXISTS "Users can delete own chunks" ON au_document_chunks;

CREATE POLICY "Users can delete own chunks"
  ON au_document_chunks
  FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================
-- UPDATE policy (if chunks need updating)
-- ============================================
DROP POLICY IF EXISTS "Users can update own chunks" ON au_document_chunks;

CREATE POLICY "Users can update own chunks"
  ON au_document_chunks
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================
-- VIEW / SELECT policy
-- ============================================
DROP POLICY IF EXISTS "Users can view own chunks" ON au_document_chunks;

CREATE POLICY "Users can view own chunks"
  ON au_document_chunks
  FOR SELECT
  USING (auth.uid() = user_id);
