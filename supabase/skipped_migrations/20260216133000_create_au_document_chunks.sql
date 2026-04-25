CREATE TABLE IF NOT EXISTS public.au_document_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid REFERENCES public.au_documents(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) NOT NULL,
  chunk_index int NOT NULL,
  text text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS au_document_chunks_document_id_idx ON public.au_document_chunks(document_id);
CREATE INDEX IF NOT EXISTS au_document_chunks_user_doc_idx ON public.au_document_chunks(user_id, document_id, chunk_index);

ALTER TABLE public.au_document_chunks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own chunks" ON public.au_document_chunks;
DROP POLICY IF EXISTS "Users can insert own chunks" ON public.au_document_chunks;
DROP POLICY IF EXISTS "Users can update own chunks" ON public.au_document_chunks;
DROP POLICY IF EXISTS "Users can delete own chunks" ON public.au_document_chunks;

CREATE POLICY "Users can view own chunks" ON public.au_document_chunks
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own chunks" ON public.au_document_chunks
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own chunks" ON public.au_document_chunks
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own chunks" ON public.au_document_chunks
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

NOTIFY pgrst, 'reload schema';
