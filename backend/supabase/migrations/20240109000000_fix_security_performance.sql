-- Migration: Fix Security and Performance Issues
-- Date: 2026-01-09
-- Priority: CRITICAL

-- ============================================================================
-- 1. SECURITY FIXES
-- ============================================================================

-- Fix function search_path security vulnerability
ALTER FUNCTION public.au_vector_search SET search_path = '';
ALTER FUNCTION public.match_documents SET search_path = '';

-- ============================================================================
-- 2. PERFORMANCE FIXES: Add Missing Foreign Key Indexes
-- ============================================================================

-- au_document_chunks indexes
CREATE INDEX IF NOT EXISTS idx_document_chunks_document_id ON au_document_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_document_chunks_user_id ON au_document_chunks(user_id);

-- au_document_embeddings indexes
CREATE INDEX IF NOT EXISTS idx_document_embeddings_chunk_id ON au_document_embeddings(chunk_id);

-- au_documents indexes
CREATE INDEX IF NOT EXISTS idx_documents_user_id ON au_documents(user_id);
CREATE INDEX IF NOT EXISTS idx_documents_parent_id ON au_documents(parent_id);
CREATE INDEX IF NOT EXISTS idx_documents_guest_session_id ON au_documents(guest_session_id);
CREATE INDEX IF NOT EXISTS idx_documents_status ON au_documents(status); -- For filtering by status

-- au_messages indexes
CREATE INDEX IF NOT EXISTS idx_messages_session_id ON au_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_messages_user_id ON au_messages(user_id);

-- au_sessions indexes
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON au_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_guest_session_id ON au_sessions(guest_session_id);

-- au_upload_jobs indexes
CREATE INDEX IF NOT EXISTS idx_upload_jobs_document_id ON au_upload_jobs(document_id);
CREATE INDEX IF NOT EXISTS idx_upload_jobs_user_id ON au_upload_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_upload_jobs_status ON au_upload_jobs(status); -- For filtering active jobs

-- au_guest_sessions indexes (for cleanup queries)
CREATE INDEX IF NOT EXISTS idx_guest_sessions_expires_at ON au_guest_sessions(expires_at);

-- ============================================================================
-- 3. PERFORMANCE FIXES: Optimize RLS Policies
-- ============================================================================

-- Note: This is a large change. We'll update the most critical policies.
-- For full optimization, all policies should use (SELECT auth.uid()) instead of auth.uid()

-- Drop and recreate au_documents policies with optimized auth.uid() calls
DROP POLICY IF EXISTS "Users can view own documents" ON au_documents;
DROP POLICY IF EXISTS "Users can insert own documents" ON au_documents;
DROP POLICY IF EXISTS "Users can update own documents" ON au_documents;
DROP POLICY IF EXISTS "Users can delete own documents" ON au_documents;

CREATE POLICY "Users can view own documents" ON au_documents
  FOR SELECT USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can insert own documents" ON au_documents
  FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can update own documents" ON au_documents
  FOR UPDATE USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can delete own documents" ON au_documents
  FOR DELETE USING ((SELECT auth.uid()) = user_id);

-- Optimize guest policies (they already use current_setting, but we can optimize the cast)
-- Note: Guest policies are harder to optimize without changing the JWT claim structure
-- Keeping them as-is for now, but they should be reviewed

-- Optimize au_document_chunks policies
DROP POLICY IF EXISTS "Users can view own chunks" ON au_document_chunks;
CREATE POLICY "Users can view own chunks" ON au_document_chunks
  FOR SELECT USING ((SELECT auth.uid()) = user_id);

-- Optimize au_sessions policies
DROP POLICY IF EXISTS "Users can view own sessions" ON au_sessions;
DROP POLICY IF EXISTS "Users can insert own sessions" ON au_sessions;
DROP POLICY IF EXISTS "Users can update own sessions" ON au_sessions;
DROP POLICY IF EXISTS "Users can delete own sessions" ON au_sessions;

CREATE POLICY "Users can view own sessions" ON au_sessions
  FOR SELECT USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can insert own sessions" ON au_sessions
  FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can update own sessions" ON au_sessions
  FOR UPDATE USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can delete own sessions" ON au_sessions
  FOR DELETE USING ((SELECT auth.uid()) = user_id);

-- Optimize au_messages policies
DROP POLICY IF EXISTS "Users can view own messages" ON au_messages;
DROP POLICY IF EXISTS "Users can insert own messages" ON au_messages;

CREATE POLICY "Users can view own messages" ON au_messages
  FOR SELECT USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can insert own messages" ON au_messages
  FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);

-- Optimize au_upload_jobs policies
DROP POLICY IF EXISTS "Users can view own upload jobs" ON au_upload_jobs;
DROP POLICY IF EXISTS "Users can insert own upload jobs" ON au_upload_jobs;
DROP POLICY IF EXISTS "Users can update own upload jobs" ON au_upload_jobs;
DROP POLICY IF EXISTS "Users can delete own upload jobs" ON au_upload_jobs;

CREATE POLICY "Users can view own upload jobs" ON au_upload_jobs
  FOR SELECT USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can insert own upload jobs" ON au_upload_jobs
  FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can update own upload jobs" ON au_upload_jobs
  FOR UPDATE USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can delete own upload jobs" ON au_upload_jobs
  FOR DELETE USING ((SELECT auth.uid()) = user_id);

-- ============================================================================
-- 4. DATA INTEGRITY: Add Status Index for Cleanup Queries
-- ============================================================================

-- Already added above: idx_documents_status, idx_upload_jobs_status

-- ============================================================================
-- 5. HELPER FUNCTION: Cleanup Stuck Documents
-- ============================================================================

-- Function to mark documents as failed if stuck in processing/uploading for > 1 hour
CREATE OR REPLACE FUNCTION public.cleanup_stuck_documents()
RETURNS TABLE(cleaned_count integer, document_ids uuid[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cleaned_count integer;
  v_document_ids uuid[];
BEGIN
  -- Mark documents stuck in 'processing' or 'uploading' for > 1 hour as 'failed'
  WITH stuck_docs AS (
    UPDATE au_documents
    SET status = 'failed',
        error = COALESCE(error, 'Processing timeout: stuck for > 1 hour')
    WHERE status IN ('processing', 'uploading')
      AND created_at < now() - interval '1 hour'
      AND id IN (
        SELECT id FROM au_documents
        WHERE status IN ('processing', 'uploading')
          AND created_at < now() - interval '1 hour'
      )
    RETURNING id
  )
  SELECT COUNT(*), array_agg(id) INTO v_cleaned_count, v_document_ids
  FROM stuck_docs;

  RETURN QUERY SELECT v_cleaned_count, v_document_ids;
END;
$$;

-- Grant execute permission to service_role (Edge Functions)
GRANT EXECUTE ON FUNCTION public.cleanup_stuck_documents() TO service_role;

-- ============================================================================
-- 6. UPDATE RPC FUNCTIONS: Support Guest Sessions
-- ============================================================================

-- Update au_vector_search to support guest sessions
CREATE OR REPLACE FUNCTION public.au_vector_search(
  query_embedding vector,
  match_threshold double precision,
  match_count integer,
  p_user_id uuid DEFAULT NULL,
  p_guest_session_id uuid DEFAULT NULL
)
RETURNS TABLE(chunk_id uuid, text text, similarity double precision, file_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_user_id IS NULL AND p_guest_session_id IS NULL THEN
    RAISE EXCEPTION 'Either p_user_id or p_guest_session_id must be provided';
  END IF;

  RETURN QUERY
  SELECT
    c.id as chunk_id,
    c.text,
    1 - (e.embedding <=> query_embedding) as similarity,
    d.file_name
  FROM au_document_embeddings e
  JOIN au_document_chunks c ON e.chunk_id = c.id
  JOIN au_documents d ON c.document_id = d.id
  WHERE (
    (p_user_id IS NOT NULL AND d.user_id = p_user_id) OR
    (p_guest_session_id IS NOT NULL AND d.guest_session_id = p_guest_session_id)
  )
  AND 1 - (e.embedding <=> query_embedding) > match_threshold
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Update match_documents to support guest sessions
CREATE OR REPLACE FUNCTION public.match_documents(
  query_embedding vector,
  match_threshold double precision,
  match_count integer,
  p_user_id uuid DEFAULT NULL,
  p_guest_session_id uuid DEFAULT NULL
)
RETURNS TABLE(id uuid, text text, similarity double precision)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_user_id IS NULL AND p_guest_session_id IS NULL THEN
    RAISE EXCEPTION 'Either p_user_id or p_guest_session_id must be provided';
  END IF;

  RETURN QUERY
  SELECT
    au_document_chunks.id,
    au_document_chunks.text,
    1 - (au_document_chunks.embedding <=> query_embedding) as similarity
  FROM au_document_chunks
  JOIN au_documents d ON au_document_chunks.document_id = d.id
  WHERE (
    (p_user_id IS NOT NULL AND au_document_chunks.user_id = p_user_id) OR
    (p_guest_session_id IS NOT NULL AND d.guest_session_id = p_guest_session_id)
  )
  AND 1 - (au_document_chunks.embedding <=> query_embedding) > match_threshold
  ORDER BY au_document_chunks.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.au_vector_search(vector, double precision, integer, uuid, uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.match_documents(vector, double precision, integer, uuid, uuid) TO authenticated, anon;
