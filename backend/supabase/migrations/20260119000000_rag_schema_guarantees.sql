-- Migration: RAG Schema Guarantees
-- Description: Adds text_hash, UNIQUE constraints, and ivfflat index for RAG production readiness.
-- Date: 2026-01-19

-- 1. Update au_document_chunks
ALTER TABLE au_document_chunks ADD COLUMN IF NOT EXISTS text_hash TEXT;

-- Create function to compute md5 hash
CREATE OR REPLACE FUNCTION compute_text_hash()
RETURNS TRIGGER AS $$
BEGIN
  NEW.text_hash := md5(NEW.text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
DROP TRIGGER IF EXISTS trg_compute_text_hash ON au_document_chunks;
CREATE TRIGGER trg_compute_text_hash
BEFORE INSERT OR UPDATE OF text ON au_document_chunks
FOR EACH ROW EXECUTE FUNCTION compute_text_hash();

-- Backfill existing text_hash
UPDATE au_document_chunks SET text_hash = md5(text) WHERE text_hash IS NULL;

-- Add UNIQUE constraint
-- Note: document_id and text_hash
-- We use a name that is unlikely to conflict
ALTER TABLE au_document_chunks DROP CONSTRAINT IF EXISTS au_document_chunks_doc_text_unique;
ALTER TABLE au_document_chunks ADD CONSTRAINT au_document_chunks_doc_text_unique UNIQUE (document_id, text_hash);

-- 2. Update au_document_embeddings
ALTER TABLE au_document_embeddings DROP CONSTRAINT IF EXISTS au_document_embeddings_chunk_model_unique;
ALTER TABLE au_document_embeddings ADD CONSTRAINT au_document_embeddings_chunk_model_unique UNIQUE (chunk_id, model_name);

-- 3. Add ivfflat index
-- Note: Using 1536 dimensions for OpenAI. lists=100 is a common starting point for medium datasets.
-- We use cosine distance (vector_cosine_ops) as it is standard for RAG.
CREATE INDEX IF NOT EXISTS idx_au_document_embeddings_vector 
ON au_document_embeddings USING ivfflat (embedding vector_cosine_ops) 
WITH (lists = 100);

-- 5. Updated vector search with ivfflat tuning and metadata
CREATE OR REPLACE FUNCTION au_vector_search (
  query_embedding vector(1536),
  match_threshold float,
  match_count int,
  p_user_id uuid DEFAULT NULL,
  p_guest_session_id uuid DEFAULT NULL,
  p_probes int DEFAULT 10
)
RETURNS TABLE (
  chunk_id uuid,
  document_id uuid,
  text text,
  similarity float,
  file_name text,
  model_name text,
  embedding vector(1536)
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Set ivfflat.probes for the current transaction
  -- This tunes the search quality vs speed
  EXECUTE format('SET LOCAL ivfflat.probes = %L', p_probes);

  RETURN QUERY
  SELECT
    c.id as chunk_id,
    c.document_id,
    c.text,
    (1 - (e.embedding <=> query_embedding))::float as similarity,
    d.file_name,
    e.model_name,
    e.embedding
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

-- 6. RPC to claim a job safely with concurrency control
CREATE OR REPLACE FUNCTION claim_upload_job()
RETURNS TABLE (
  job_id uuid,
  document_id uuid,
  user_id uuid,
  guest_session_id uuid,
  file_name text,
  bucket text,
  object_path text
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  claimed_job_id uuid;
BEGIN
  -- Select one queued job and lock it
  -- FOR UPDATE SKIP LOCKED prevents multiple workers from claiming the same job
  SELECT id INTO claimed_job_id
  FROM au_upload_jobs
  WHERE status = 'queued'
  ORDER BY created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF claimed_job_id IS NOT NULL THEN
    -- Update status to processing immediately
    UPDATE au_upload_jobs
    SET status = 'processing',
        updated_at = now()
    WHERE id = claimed_job_id;

    RETURN QUERY
    SELECT 
      j.id, 
      j.document_id, 
      j.user_id, 
      j.guest_session_id,
      j.file_name, 
      j.bucket, 
      j.object_path
    FROM au_upload_jobs j
    WHERE j.id = claimed_job_id;
  END IF;
END;
$$;
