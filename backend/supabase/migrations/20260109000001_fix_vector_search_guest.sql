-- Fix au_vector_search to support both authenticated users and guest sessions
-- Also address security (search_path) and performance issues

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
    (p_user_id IS NULL AND p_guest_session_id IS NULL) -- Allow searching everything if no filter provided (since RLS is disabled)
  )
  AND 1 - (e.embedding <=> query_embedding) > match_threshold
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Also update match_documents for consistency
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
    1 - (c.embedding <=> query_embedding) as similarity
  FROM public.au_document_chunks c
  JOIN public.au_documents d ON c.document_id = d.id
  WHERE (
    (p_user_id IS NOT NULL AND d.user_id = p_user_id) OR 
    (p_guest_session_id IS NOT NULL AND d.guest_session_id = p_guest_session_id) OR
    (p_user_id IS NULL AND p_guest_session_id IS NULL)
  )
  AND 1 - (c.embedding <=> query_embedding) > match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
