-- =====================================================
-- Restore Guest RLS Policies
-- Date: 2024-01-12
-- Purpose: Allow guest users to access their documents via guest_session_id claim
-- =====================================================

-- 1. au_documents
CREATE POLICY "Guests can view own documents" ON au_documents
  FOR SELECT USING (
    guest_session_id::text = (current_setting('request.jwt.claims', true)::jsonb ->> 'guest_session_id')
  );

CREATE POLICY "Guests can insert own documents" ON au_documents
  FOR INSERT WITH CHECK (
    guest_session_id::text = (current_setting('request.jwt.claims', true)::jsonb ->> 'guest_session_id')
  );

CREATE POLICY "Guests can update own documents" ON au_documents
  FOR UPDATE USING (
    guest_session_id::text = (current_setting('request.jwt.claims', true)::jsonb ->> 'guest_session_id')
  )
  WITH CHECK (
    guest_session_id::text = (current_setting('request.jwt.claims', true)::jsonb ->> 'guest_session_id')
  );

CREATE POLICY "Guests can delete own documents" ON au_documents
  FOR DELETE USING (
    guest_session_id::text = (current_setting('request.jwt.claims', true)::jsonb ->> 'guest_session_id')
  );

-- 2. au_upload_jobs
CREATE POLICY "Guests can view own upload jobs" ON au_upload_jobs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM au_documents d 
      WHERE d.id = au_upload_jobs.document_id 
      AND d.guest_session_id::text = (current_setting('request.jwt.claims', true)::jsonb ->> 'guest_session_id')
    )
  );

CREATE POLICY "Guests can update own upload jobs" ON au_upload_jobs
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM au_documents d 
      WHERE d.id = au_upload_jobs.document_id 
      AND d.guest_session_id::text = (current_setting('request.jwt.claims', true)::jsonb ->> 'guest_session_id')
    )
  );

-- 3. au_document_chunks
CREATE POLICY "Guests can view own chunks" ON au_document_chunks
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM au_documents d 
      WHERE d.id = au_document_chunks.document_id 
      AND d.guest_session_id::text = (current_setting('request.jwt.claims', true)::jsonb ->> 'guest_session_id')
    )
  );

CREATE POLICY "Guests can insert own chunks" ON au_document_chunks
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM au_documents d 
      WHERE d.id = au_document_chunks.document_id 
      AND d.guest_session_id::text = (current_setting('request.jwt.claims', true)::jsonb ->> 'guest_session_id')
    )
  );
