-- Phase 6 Patch: Guest-safe Upload Jobs + Upload Pipeline RLS

ALTER TABLE au_upload_jobs
ADD COLUMN IF NOT EXISTS guest_session_id UUID REFERENCES au_guest_sessions(id) ON DELETE CASCADE;

ALTER TABLE au_upload_jobs
ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE au_upload_jobs
DROP CONSTRAINT IF EXISTS au_upload_jobs_owner_chk;

ALTER TABLE au_upload_jobs
ADD CONSTRAINT au_upload_jobs_owner_chk
CHECK (
  (user_id IS NOT NULL AND guest_session_id IS NULL)
  OR (user_id IS NULL AND guest_session_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS au_upload_jobs_guest_session_id_idx ON au_upload_jobs(guest_session_id);

DROP POLICY IF EXISTS "Users can view own upload jobs" ON au_upload_jobs;
DROP POLICY IF EXISTS "Users can insert own upload jobs" ON au_upload_jobs;
DROP POLICY IF EXISTS "Users can update own upload jobs" ON au_upload_jobs;
DROP POLICY IF EXISTS "Users can delete own upload jobs" ON au_upload_jobs;

CREATE POLICY "Users can view own upload jobs" ON au_upload_jobs
  FOR SELECT USING (
    auth.uid() = user_id
    OR guest_session_id::text = (current_setting('request.jwt.claims', true)::jsonb ->> 'guest_session_id')
  );

CREATE POLICY "Users can insert own upload jobs" ON au_upload_jobs
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    OR guest_session_id::text = (current_setting('request.jwt.claims', true)::jsonb ->> 'guest_session_id')
  );

CREATE POLICY "Users can update own upload jobs" ON au_upload_jobs
  FOR UPDATE USING (
    auth.uid() = user_id
    OR guest_session_id::text = (current_setting('request.jwt.claims', true)::jsonb ->> 'guest_session_id')
  )
  WITH CHECK (
    auth.uid() = user_id
    OR guest_session_id::text = (current_setting('request.jwt.claims', true)::jsonb ->> 'guest_session_id')
  );

CREATE POLICY "Users can delete own upload jobs" ON au_upload_jobs
  FOR DELETE USING (
    auth.uid() = user_id
    OR guest_session_id::text = (current_setting('request.jwt.claims', true)::jsonb ->> 'guest_session_id')
  );

DROP POLICY IF EXISTS "Users can insert own chunks" ON au_document_chunks;
DROP POLICY IF EXISTS "Users can update own chunks" ON au_document_chunks;
DROP POLICY IF EXISTS "Users can delete own chunks" ON au_document_chunks;
DROP POLICY IF EXISTS "Guests can insert own chunks" ON au_document_chunks;
DROP POLICY IF EXISTS "Guests can update own chunks" ON au_document_chunks;
DROP POLICY IF EXISTS "Guests can delete own chunks" ON au_document_chunks;

CREATE POLICY "Users can insert own chunks" ON au_document_chunks
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own chunks" ON au_document_chunks
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own chunks" ON au_document_chunks
  FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Guests can insert own chunks" ON au_document_chunks
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM au_documents d
      WHERE d.id = au_document_chunks.document_id
      AND d.guest_session_id::text = (current_setting('request.jwt.claims', true)::jsonb ->> 'guest_session_id')
    )
  );

CREATE POLICY "Guests can update own chunks" ON au_document_chunks
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM au_documents d
      WHERE d.id = au_document_chunks.document_id
      AND d.guest_session_id::text = (current_setting('request.jwt.claims', true)::jsonb ->> 'guest_session_id')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM au_documents d
      WHERE d.id = au_document_chunks.document_id
      AND d.guest_session_id::text = (current_setting('request.jwt.claims', true)::jsonb ->> 'guest_session_id')
    )
  );

CREATE POLICY "Guests can delete own chunks" ON au_document_chunks
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM au_documents d
      WHERE d.id = au_document_chunks.document_id
      AND d.guest_session_id::text = (current_setting('request.jwt.claims', true)::jsonb ->> 'guest_session_id')
    )
  );

DROP POLICY IF EXISTS "Users can insert own embeddings" ON au_document_embeddings;
DROP POLICY IF EXISTS "Users can update own embeddings" ON au_document_embeddings;
DROP POLICY IF EXISTS "Users can delete own embeddings" ON au_document_embeddings;
DROP POLICY IF EXISTS "Guests can view own embeddings" ON au_document_embeddings;
DROP POLICY IF EXISTS "Guests can insert own embeddings" ON au_document_embeddings;
DROP POLICY IF EXISTS "Guests can update own embeddings" ON au_document_embeddings;
DROP POLICY IF EXISTS "Guests can delete own embeddings" ON au_document_embeddings;

CREATE POLICY "Users can insert own embeddings" ON au_document_embeddings
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM au_document_chunks c
      WHERE c.id = au_document_embeddings.chunk_id
      AND c.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update own embeddings" ON au_document_embeddings
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM au_document_chunks c
      WHERE c.id = au_document_embeddings.chunk_id
      AND c.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM au_document_chunks c
      WHERE c.id = au_document_embeddings.chunk_id
      AND c.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own embeddings" ON au_document_embeddings
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM au_document_chunks c
      WHERE c.id = au_document_embeddings.chunk_id
      AND c.user_id = auth.uid()
    )
  );

CREATE POLICY "Guests can view own embeddings" ON au_document_embeddings
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM au_document_chunks c
      JOIN au_documents d ON d.id = c.document_id
      WHERE c.id = au_document_embeddings.chunk_id
      AND d.guest_session_id::text = (current_setting('request.jwt.claims', true)::jsonb ->> 'guest_session_id')
    )
  );

CREATE POLICY "Guests can insert own embeddings" ON au_document_embeddings
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1
      FROM au_document_chunks c
      JOIN au_documents d ON d.id = c.document_id
      WHERE c.id = au_document_embeddings.chunk_id
      AND d.guest_session_id::text = (current_setting('request.jwt.claims', true)::jsonb ->> 'guest_session_id')
    )
  );

CREATE POLICY "Guests can update own embeddings" ON au_document_embeddings
  FOR UPDATE USING (
    EXISTS (
      SELECT 1
      FROM au_document_chunks c
      JOIN au_documents d ON d.id = c.document_id
      WHERE c.id = au_document_embeddings.chunk_id
      AND d.guest_session_id::text = (current_setting('request.jwt.claims', true)::jsonb ->> 'guest_session_id')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM au_document_chunks c
      JOIN au_documents d ON d.id = c.document_id
      WHERE c.id = au_document_embeddings.chunk_id
      AND d.guest_session_id::text = (current_setting('request.jwt.claims', true)::jsonb ->> 'guest_session_id')
    )
  );

CREATE POLICY "Guests can delete own embeddings" ON au_document_embeddings
  FOR DELETE USING (
    EXISTS (
      SELECT 1
      FROM au_document_chunks c
      JOIN au_documents d ON d.id = c.document_id
      WHERE c.id = au_document_embeddings.chunk_id
      AND d.guest_session_id::text = (current_setting('request.jwt.claims', true)::jsonb ->> 'guest_session_id')
    )
  );
