-- Ensure missing tables required by chat and proxy are present
-- 20260307210000_ensure_chat_tables.sql

BEGIN;

-- 1. Create au_messages table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.au_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    thread_id TEXT NOT NULL,
    session_id TEXT,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    correlation_id TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Ensure session_id exists for backward compatibility with older code
ALTER TABLE public.au_messages ADD COLUMN IF NOT EXISTS session_id TEXT;

-- Trigger to sync thread_id and session_id
CREATE OR REPLACE FUNCTION public.sync_chat_identifiers()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.thread_id IS NULL AND NEW.session_id IS NOT NULL THEN
        NEW.thread_id := NEW.session_id;
    ELSIF NEW.session_id IS NULL AND NEW.thread_id IS NOT NULL THEN
        NEW.session_id := NEW.thread_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_chat_identifiers ON public.au_messages;
CREATE TRIGGER trg_sync_chat_identifiers
BEFORE INSERT OR UPDATE ON public.au_messages
FOR EACH ROW EXECUTE FUNCTION public.sync_chat_identifiers();

-- Enable RLS
ALTER TABLE public.au_messages ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Users can manage own messages" ON public.au_messages;
CREATE POLICY "Users can manage own messages" ON public.au_messages
    FOR ALL TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- 2. Create au_upload_jobs as a view over au_worker_jobs for backward compatibility
-- If au_upload_jobs table exists as a real table, we leave it alone.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'au_upload_jobs') THEN
        IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'au_worker_jobs') THEN
            CREATE OR REPLACE VIEW public.au_upload_jobs AS
            SELECT 
                id,
                user_id,
                owner_id,
                file_name,
                status,
                created_at,
                updated_at,
                metadata
            FROM public.au_worker_jobs;
        ELSE
            -- Fallback if au_worker_jobs is also missing (unlikely but safe)
            CREATE TABLE public.au_upload_jobs (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID REFERENCES auth.users(id),
                owner_id UUID REFERENCES auth.users(id),
                file_name TEXT,
                status TEXT,
                created_at TIMESTAMPTZ DEFAULT now(),
                updated_at TIMESTAMPTZ DEFAULT now(),
                metadata JSONB DEFAULT '{}'::jsonb
            );
        END IF;
    END IF;
END $$;

-- 3. Ensure au_quota_windows exists (it was OK in my check, but safe to ensure)
CREATE TABLE IF NOT EXISTS public.au_quota_windows (
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    metric TEXT NOT NULL,
    window_start TIMESTAMPTZ NOT NULL,
    window_end TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (user_id, metric)
);

ALTER TABLE public.au_quota_windows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own quota windows" ON public.au_quota_windows;
CREATE POLICY "Users can view own quota windows" ON public.au_quota_windows
    FOR SELECT TO authenticated
    USING (auth.uid() = user_id);

-- 4. Fix is_schema_drift_error resilience in Node.js code (this is handled in JS change)

NOTIFY pgrst, 'reload schema';

COMMIT;
