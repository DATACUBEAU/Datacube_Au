-- Disable RLS on AU tables as per request
-- This shifts security responsibility to the Edge Functions using service_role and manual filtering

ALTER TABLE au_documents DISABLE ROW LEVEL SECURITY;
ALTER TABLE au_document_chunks DISABLE ROW LEVEL SECURITY;
ALTER TABLE au_upload_jobs DISABLE ROW LEVEL SECURITY;
ALTER TABLE au_document_embeddings DISABLE ROW LEVEL SECURITY;
ALTER TABLE au_guest_sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE au_sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE au_messages DISABLE ROW LEVEL SECURITY;
ALTER TABLE au_model_usage DISABLE ROW LEVEL SECURITY;
ALTER TABLE au_api_keys DISABLE ROW LEVEL SECURITY;
ALTER TABLE au_rag_settings DISABLE ROW LEVEL SECURITY;
ALTER TABLE au_openrouter_config DISABLE ROW LEVEL SECURITY;

-- Ensure all tables have guest_session_id for consistent manual filtering
ALTER TABLE au_documents ADD COLUMN IF NOT EXISTS guest_session_id UUID REFERENCES au_guest_sessions(id) ON DELETE CASCADE;
ALTER TABLE au_documents ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE au_document_chunks ADD COLUMN IF NOT EXISTS guest_session_id UUID REFERENCES au_guest_sessions(id) ON DELETE CASCADE;
ALTER TABLE au_messages ADD COLUMN IF NOT EXISTS guest_session_id UUID REFERENCES au_guest_sessions(id) ON DELETE CASCADE;
ALTER TABLE au_model_usage ADD COLUMN IF NOT EXISTS guest_session_id UUID REFERENCES au_guest_sessions(id) ON DELETE CASCADE;
ALTER TABLE au_model_usage ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE au_upload_jobs ADD COLUMN IF NOT EXISTS guest_session_id UUID REFERENCES au_guest_sessions(id) ON DELETE CASCADE;
ALTER TABLE au_upload_jobs ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE au_sessions ADD COLUMN IF NOT EXISTS guest_session_id UUID REFERENCES au_guest_sessions(id) ON DELETE CASCADE;
ALTER TABLE au_sessions ALTER COLUMN user_id DROP NOT NULL;

-- 4. Update RPCs for manual ownership filtering (bypass RLS)
-- These functions are used by the RAG pipeline and vector search Edge Functions

CREATE OR REPLACE FUNCTION public.au_vector_search (
  query_embedding vector(1536),
  match_threshold float,
  match_count int,
  p_user_id uuid DEFAULT NULL,
  p_guest_session_id text DEFAULT NULL
)
RETURNS TABLE (
  chunk_id uuid,
  text text,
  similarity float,
  file_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id as chunk_id,
    c.text,
    1 - (e.embedding <=> query_embedding) as similarity,
    d.file_name
  FROM public.au_document_embeddings e
  JOIN public.au_document_chunks c ON e.chunk_id = c.id
  JOIN public.au_documents d ON c.document_id = d.id
  WHERE (
    (p_user_id IS NOT NULL AND d.user_id = p_user_id) OR 
    (p_guest_session_id IS NOT NULL AND d.guest_session_id = p_guest_session_id) OR
    (p_user_id IS NULL AND p_guest_session_id IS NULL)
  )
  AND 1 - (e.embedding <=> query_embedding) > match_threshold
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Alias for match_documents which is often used in RAG tutorials/codebases
CREATE OR REPLACE FUNCTION public.match_documents (
  query_embedding vector(1536),
  match_threshold float,
  match_count int,
  p_user_id uuid DEFAULT NULL,
  p_guest_session_id text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  text text,
  similarity float
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.text,
    1 - (e.embedding <=> query_embedding) as similarity
  FROM public.au_document_embeddings e
  JOIN public.au_document_chunks c ON e.chunk_id = c.id
  JOIN public.au_documents d ON c.document_id = d.id
  WHERE (
    (p_user_id IS NOT NULL AND d.user_id = p_user_id) OR 
    (p_guest_session_id IS NOT NULL AND d.guest_session_id = p_guest_session_id) OR
    (p_user_id IS NULL AND p_guest_session_id IS NULL)
  )
  AND 1 - (e.embedding <=> query_embedding) > match_threshold
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
