-- Phase 5: Secure Guest System (Ephemeral)

-- 1. Guest Sessions Table
CREATE TABLE IF NOT EXISTS au_guest_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ DEFAULT (now() + interval '24 hours')
);

ALTER TABLE au_guest_sessions ENABLE ROW LEVEL SECURITY;

-- Only service_role can manage guest sessions (Edge Function)
CREATE POLICY "Service role manages guest sessions" ON au_guest_sessions
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- 2. Update Documents to support Guest Ownership
ALTER TABLE au_documents 
ADD COLUMN IF NOT EXISTS guest_session_id UUID REFERENCES au_guest_sessions(id) ON DELETE CASCADE;

-- Allow user_id to be nullable for guest docs (if not already)
ALTER TABLE au_documents ALTER COLUMN user_id DROP NOT NULL;

-- 3. Update RLS on au_documents
-- Drop existing policies to recreate them with guest support
DROP POLICY IF EXISTS "Users can view own documents" ON au_documents;
DROP POLICY IF EXISTS "Users can insert own documents" ON au_documents;
DROP POLICY IF EXISTS "Users can update own documents" ON au_documents;
DROP POLICY IF EXISTS "Users can delete own documents" ON au_documents;

-- Policy: Auth Users (Standard)
CREATE POLICY "Users can view own documents" ON au_documents
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own documents" ON au_documents
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own documents" ON au_documents
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own documents" ON au_documents
  FOR DELETE USING (auth.uid() = user_id);

-- Policy: Guests (JWT Claim based)
-- Note: 'request.jwt.claims' is a JSON object. We extract the custom claim.
-- We cast the claim to text and compare with the column.
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
  );

CREATE POLICY "Guests can delete own documents" ON au_documents
  FOR DELETE USING (
    guest_session_id::text = (current_setting('request.jwt.claims', true)::jsonb ->> 'guest_session_id')
  );

-- 4. Update other tables similarly (Chunks, Messages, etc.)

-- au_document_chunks (Already cascades delete from documents, but RLS needs update if we query chunks directly)
ALTER TABLE au_document_chunks ALTER COLUMN user_id DROP NOT NULL;
-- Note: Chunks usually query via document_id, but if we have direct RLS:
DROP POLICY IF EXISTS "Users can view own chunks" ON au_document_chunks;

CREATE POLICY "Users can view own chunks" ON au_document_chunks
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Guests can view own chunks" ON au_document_chunks
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM au_documents d 
      WHERE d.id = au_document_chunks.document_id 
      AND d.guest_session_id::text = (current_setting('request.jwt.claims', true)::jsonb ->> 'guest_session_id')
    )
  );

-- au_messages / au_sessions
ALTER TABLE au_sessions ADD COLUMN IF NOT EXISTS guest_session_id UUID REFERENCES au_guest_sessions(id) ON DELETE CASCADE;
ALTER TABLE au_sessions ALTER COLUMN user_id DROP NOT NULL;

DROP POLICY IF EXISTS "Users can view own sessions" ON au_sessions;
DROP POLICY IF EXISTS "Users can insert own sessions" ON au_sessions;
DROP POLICY IF EXISTS "Users can update own sessions" ON au_sessions;
DROP POLICY IF EXISTS "Users can delete own sessions" ON au_sessions;

CREATE POLICY "Users can view own sessions" ON au_sessions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own sessions" ON au_sessions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own sessions" ON au_sessions FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own sessions" ON au_sessions FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Guests can view own sessions" ON au_sessions
  FOR SELECT USING (guest_session_id::text = (current_setting('request.jwt.claims', true)::jsonb ->> 'guest_session_id'));

CREATE POLICY "Guests can insert own sessions" ON au_sessions
  FOR INSERT WITH CHECK (guest_session_id::text = (current_setting('request.jwt.claims', true)::jsonb ->> 'guest_session_id'));

CREATE POLICY "Guests can update own sessions" ON au_sessions
  FOR UPDATE USING (guest_session_id::text = (current_setting('request.jwt.claims', true)::jsonb ->> 'guest_session_id'));

CREATE POLICY "Guests can delete own sessions" ON au_sessions
  FOR DELETE USING (guest_session_id::text = (current_setting('request.jwt.claims', true)::jsonb ->> 'guest_session_id'));

-- au_messages (Cascades from sessions usually, but has RLS)
ALTER TABLE au_messages ALTER COLUMN user_id DROP NOT NULL;

DROP POLICY IF EXISTS "Users can view own messages" ON au_messages;
DROP POLICY IF EXISTS "Users can insert own messages" ON au_messages;

CREATE POLICY "Users can view own messages" ON au_messages FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own messages" ON au_messages FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Guests can view own messages" ON au_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM au_sessions s
      WHERE s.id = au_messages.session_id
      AND s.guest_session_id::text = (current_setting('request.jwt.claims', true)::jsonb ->> 'guest_session_id')
    )
  );

CREATE POLICY "Guests can insert own messages" ON au_messages
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM au_sessions s
      WHERE s.id = au_messages.session_id
      AND s.guest_session_id::text = (current_setting('request.jwt.claims', true)::jsonb ->> 'guest_session_id')
    )
  );

-- 5. Cleanup Cron (Requires pg_cron extension, usually available on Supabase)
-- We wrap in a DO block to avoid errors if extension not present/permission issues
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'cleanup_guest_data',
      '0 * * * *', -- Every hour
      'DELETE FROM au_guest_sessions WHERE expires_at < now()'
    );
  END IF;
END $$;
