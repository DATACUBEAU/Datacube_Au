-- Create memory_summaries (Hybrid Memory - long-term summaries only)
CREATE TABLE IF NOT EXISTS public.memory_summaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    scope TEXT NOT NULL CHECK (scope IN ('global', 'doc')),
    doc_id TEXT,
    summary TEXT NOT NULL DEFAULT '' CHECK (octet_length(summary) <= 8192),
    pinned_facts JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT memory_summaries_scope_doc_id_check CHECK (
        (scope = 'global' AND doc_id IS NULL) OR (scope = 'doc' AND doc_id IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_summaries_user_scope_doc
ON public.memory_summaries (user_id, scope, COALESCE(doc_id, ''));

CREATE INDEX IF NOT EXISTS idx_memory_summaries_user_updated
ON public.memory_summaries (user_id, updated_at DESC);

ALTER TABLE public.memory_summaries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own memory summaries" ON public.memory_summaries;
DROP POLICY IF EXISTS "Users can insert own memory summaries" ON public.memory_summaries;
DROP POLICY IF EXISTS "Users can update own memory summaries" ON public.memory_summaries;
DROP POLICY IF EXISTS "Users can delete own memory summaries" ON public.memory_summaries;
DROP POLICY IF EXISTS "Service role full access" ON public.memory_summaries;

CREATE POLICY "Users can read own memory summaries" ON public.memory_summaries
    FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own memory summaries" ON public.memory_summaries
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own memory summaries" ON public.memory_summaries
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own memory summaries" ON public.memory_summaries
    FOR DELETE
    USING (auth.uid() = user_id);

CREATE POLICY "Service role full access" ON public.memory_summaries
    TO service_role USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
