-- Phase 3 & 4 Schema Update: Datacube AU

-- 1. Ensure AU naming convention (Renaming existing tables if they don't match or creating new ones)
-- We already have au_documents and au_document_chunks from previous steps.

-- 2. New Tables for Phase 4 (Admin Control & Chat History)

-- AU Sessions (Chat Sessions)
CREATE TABLE IF NOT EXISTS au_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users NOT NULL,
  title TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  metadata JSONB DEFAULT '{}'::jsonb
);

ALTER TABLE au_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own sessions" ON au_sessions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own sessions" ON au_sessions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own sessions" ON au_sessions
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own sessions" ON au_sessions
  FOR DELETE USING (auth.uid() = user_id);

-- AU Messages (Chat History)
CREATE TABLE IF NOT EXISTS au_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES au_sessions(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  metadata JSONB DEFAULT '{}'::jsonb -- Can store citation references here
);

ALTER TABLE au_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own messages" ON au_messages
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own messages" ON au_messages
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- RAG Settings (Admin Controlled)
CREATE TABLE IF NOT EXISTS au_rag_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  value JSONB NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE au_rag_settings ENABLE ROW LEVEL SECURITY;

-- Allow read access to authenticated users (to know config), write only to admin (service_role)
CREATE POLICY "Allow read access to authenticated users" ON au_rag_settings
  FOR SELECT TO authenticated USING (true);

-- OpenRouter Config (Admin Controlled)
CREATE TABLE IF NOT EXISTS au_openrouter_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id TEXT NOT NULL, -- e.g., 'google/gemini-2.0-flash-exp:free'
  is_active BOOLEAN DEFAULT false,
  parameters JSONB DEFAULT '{}'::jsonb, -- temperature, top_p etc.
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE au_openrouter_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read access to authenticated users" ON au_openrouter_config
  FOR SELECT TO authenticated USING (true);

-- 3. Updates to Document Chunks to support Vector Search better
-- Ensuring vector extension is enabled
CREATE EXTENSION IF NOT EXISTS vector;

-- We already have au_document_chunks. Let's ensure it has the right structure for separate embeddings if needed.
-- The prompt asked for 'document_embeddings' table. 
-- We will create it to strictly follow the requirement, linking back to chunks.
-- This allows multiple embeddings per chunk (different models) if needed.

CREATE TABLE IF NOT EXISTS au_document_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chunk_id UUID REFERENCES au_document_chunks(id) ON DELETE CASCADE NOT NULL,
  embedding vector(1536), -- Dimension depends on model, 1536 is OpenAI/standard
  model_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE au_document_embeddings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own embeddings" ON au_document_embeddings
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM au_document_chunks c
      WHERE c.id = au_document_embeddings.chunk_id
      AND c.user_id = auth.uid()
    )
  );

-- 4. Vector Search Function Update
-- Updated to search via the new embeddings table if populated, or fallback to chunks if we migrate data.
-- For this refactor, we will target the new structure.

CREATE OR REPLACE FUNCTION au_vector_search (
  query_embedding vector(1536),
  match_threshold float,
  match_count int,
  p_user_id uuid
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
  WHERE d.user_id = p_user_id
  AND 1 - (e.embedding <=> query_embedding) > match_threshold
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
