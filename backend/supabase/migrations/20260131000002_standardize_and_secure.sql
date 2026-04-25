-- Migration: Standardize au_worker_jobs and Secure RAG Tables
-- 20260131000002_standardize_and_secure.sql

-- 1. Standardize au_worker_jobs
DO $$ 
BEGIN
    -- Add file_path column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='au_worker_jobs' AND column_name='file_path') THEN
        ALTER TABLE au_worker_jobs ADD COLUMN file_path TEXT;
    END IF;

    -- Migrate data from payload if possible
    UPDATE au_worker_jobs 
    SET file_path = payload->>'objectPath'
    WHERE file_path IS NULL AND payload ? 'objectPath';
END $$;

-- 1.1 Ensure au_document_chunks has guest_session_id (Safety fix for migration sync issues)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='au_document_chunks' AND column_name='guest_session_id') THEN
        ALTER TABLE au_document_chunks ADD COLUMN guest_session_id UUID REFERENCES au_guest_sessions(id) ON DELETE CASCADE;
        ALTER TABLE au_document_chunks ALTER COLUMN user_id DROP NOT NULL;
    END IF;
END $$;

-- 2. Re-enable RLS on core tables for production safety
ALTER TABLE au_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE au_document_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE au_document_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE au_worker_jobs ENABLE ROW LEVEL SECURITY;

-- 3. Define restrictive policies

-- au_documents: Users can manage their own metadata, but only service_role should ideally handle status transitions (though we allow owner update for now to keep existing logic working if any)
DROP POLICY IF EXISTS "Users can manage own documents" ON au_documents;
CREATE POLICY "Users can manage own documents" ON au_documents
    FOR ALL
    TO authenticated, anon
    USING (
        auth.uid() = user_id 
        OR 
        (guest_session_id IS NOT NULL AND guest_session_id::text = (current_setting('request.jwt.claims', true)::jsonb ->> 'guest_session_id'))
    )
    WITH CHECK (
        auth.uid() = user_id 
        OR 
        (guest_session_id IS NOT NULL AND guest_session_id::text = (current_setting('request.jwt.claims', true)::jsonb ->> 'guest_session_id'))
    );

-- au_worker_jobs: Users can only SELECT (view progress)
DROP POLICY IF EXISTS "Users can view own worker jobs" ON au_worker_jobs;
CREATE POLICY "Users can view own worker jobs" ON au_worker_jobs
    FOR SELECT
    TO authenticated, anon
    USING (
        auth.uid() = user_id 
        OR 
        (guest_session_id IS NOT NULL AND guest_session_id::text = (current_setting('request.jwt.claims', true)::jsonb ->> 'guest_session_id'))
    );

-- au_document_chunks: Users can only SELECT
DROP POLICY IF EXISTS "Users can view own chunks" ON au_document_chunks;
CREATE POLICY "Users can view own chunks" ON au_document_chunks
    FOR SELECT
    TO authenticated, anon
    USING (
        auth.uid() = user_id 
        OR 
        (guest_session_id IS NOT NULL AND guest_session_id::text = (current_setting('request.jwt.claims', true)::jsonb ->> 'guest_session_id'))
    );

-- au_document_embeddings: Users can only SELECT
DROP POLICY IF EXISTS "Users can view own embeddings" ON au_document_embeddings;
CREATE POLICY "Users can view own embeddings" ON au_document_embeddings
    FOR SELECT
    TO authenticated, anon
    USING (
        EXISTS (
            SELECT 1 FROM au_document_chunks c
            WHERE c.id = au_document_embeddings.chunk_id
            AND (
                c.user_id = auth.uid()
                OR
                (c.guest_session_id IS NOT NULL AND c.guest_session_id::text = (current_setting('request.jwt.claims', true)::jsonb ->> 'guest_session_id'))
            )
        )
    );

-- 4. Ensure service_role has full access (Implicit in Supabase, but good to be explicit about intent)
-- No explicit policies needed for service_role as it bypasses RLS.

-- 5. Notify schema reload
NOTIFY pgrst, 'reload schema';
