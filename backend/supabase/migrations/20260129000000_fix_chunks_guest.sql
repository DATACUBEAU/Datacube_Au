-- Fix Guest Support for Chunks and Embeddings
-- This migration ensures that chunks can be associated with guest sessions,
-- which was causing "Bad Request" errors during insertion when user_id was null.

-- 1. Update au_document_chunks
ALTER TABLE au_document_chunks 
ADD COLUMN IF NOT EXISTS guest_session_id UUID REFERENCES au_guest_sessions(id) ON DELETE CASCADE;

-- Make user_id nullable for guest uploads
ALTER TABLE au_document_chunks 
ALTER COLUMN user_id DROP NOT NULL;

-- Add ownership constraint
ALTER TABLE au_document_chunks 
DROP CONSTRAINT IF EXISTS au_document_chunks_owner_chk;

ALTER TABLE au_document_chunks 
ADD CONSTRAINT au_document_chunks_owner_chk 
CHECK (
  (user_id IS NOT NULL AND guest_session_id IS NULL)
  OR (user_id IS NULL AND guest_session_id IS NOT NULL)
);

-- 2. Update au_document_embeddings (linking back to chunks)
-- The embeddings table links to chunks, so it's already guest-aware via the chunk join.
-- However, we add an index to speed up the join.
CREATE INDEX IF NOT EXISTS au_document_embeddings_chunk_id_idx ON au_document_embeddings(chunk_id);

-- 3. Update au_vector_search to handle guests correctly
CREATE OR REPLACE FUNCTION au_vector_search (
  query_embedding vector(1536),
  match_threshold float,
  match_count int,
  p_user_id uuid DEFAULT NULL,
  p_guest_session_id uuid DEFAULT NULL
)
RETURNS TABLE (
  chunk_id uuid,
  text text,
  similarity float,
  file_name text
)
LANGUAGE plpgsql
AS $$
BEGIN
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
    (p_user_id IS NOT NULL AND d.user_id = p_user_id)
    OR (p_guest_session_id IS NOT NULL AND d.guest_session_id = p_guest_session_id)
  )
  AND 1 - (e.embedding <=> query_embedding) > match_threshold
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
