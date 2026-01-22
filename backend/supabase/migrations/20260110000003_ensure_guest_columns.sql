-- Ensure all AU tables have the required guest_session_id column for consistent manual filtering
-- This is a follow-up to ensure migrations are fully applied

-- 1. au_guest_sessions (Base table)
CREATE TABLE IF NOT EXISTS public.au_guest_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fingerprint TEXT,
    ip_hash TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    expires_at TIMESTAMPTZ DEFAULT (now() + interval '7 days')
);

-- 2. Add guest_session_id to all relevant tables
DO $$ 
BEGIN 
    -- au_documents
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'au_documents' AND column_name = 'guest_session_id') THEN
        ALTER TABLE au_documents ADD COLUMN guest_session_id UUID REFERENCES au_guest_sessions(id) ON DELETE CASCADE;
    END IF;
    ALTER TABLE au_documents ALTER COLUMN user_id DROP NOT NULL;

    -- au_document_chunks
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'au_document_chunks' AND column_name = 'guest_session_id') THEN
        ALTER TABLE au_document_chunks ADD COLUMN guest_session_id UUID REFERENCES au_guest_sessions(id) ON DELETE CASCADE;
    END IF;

    -- au_upload_jobs
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'au_upload_jobs' AND column_name = 'guest_session_id') THEN
        ALTER TABLE au_upload_jobs ADD COLUMN guest_session_id UUID REFERENCES au_guest_sessions(id) ON DELETE CASCADE;
    END IF;
    ALTER TABLE au_upload_jobs ALTER COLUMN user_id DROP NOT NULL;

    -- au_messages
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'au_messages' AND column_name = 'guest_session_id') THEN
        ALTER TABLE au_messages ADD COLUMN guest_session_id UUID REFERENCES au_guest_sessions(id) ON DELETE CASCADE;
    END IF;

    -- au_model_usage
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'au_model_usage' AND column_name = 'guest_session_id') THEN
        ALTER TABLE au_model_usage ADD COLUMN guest_session_id UUID REFERENCES au_guest_sessions(id) ON DELETE CASCADE;
    END IF;
    ALTER TABLE au_model_usage ALTER COLUMN user_id DROP NOT NULL;

    -- au_sessions
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'au_sessions' AND column_name = 'guest_session_id') THEN
        ALTER TABLE au_sessions ADD COLUMN guest_session_id UUID REFERENCES au_guest_sessions(id) ON DELETE CASCADE;
    END IF;
    ALTER TABLE au_sessions ALTER COLUMN user_id DROP NOT NULL;
END $$;

-- 3. Ensure RLS is disabled on all these tables (as per user request)
ALTER TABLE au_documents DISABLE ROW LEVEL SECURITY;
ALTER TABLE au_document_chunks DISABLE ROW LEVEL SECURITY;
ALTER TABLE au_upload_jobs DISABLE ROW LEVEL SECURITY;
ALTER TABLE au_guest_sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE au_messages DISABLE ROW LEVEL SECURITY;
ALTER TABLE au_model_usage DISABLE ROW LEVEL SECURITY;
ALTER TABLE au_sessions DISABLE ROW LEVEL SECURITY;
