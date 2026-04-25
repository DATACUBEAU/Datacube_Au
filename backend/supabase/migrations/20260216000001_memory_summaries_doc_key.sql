ALTER TABLE public.memory_summaries
ADD COLUMN IF NOT EXISTS doc_key TEXT GENERATED ALWAYS AS (COALESCE(doc_id, '')) STORED;

DROP INDEX IF EXISTS public.idx_memory_summaries_user_scope_doc;

CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_summaries_user_scope_doc_key
ON public.memory_summaries (user_id, scope, doc_key);

NOTIFY pgrst, 'reload schema';
