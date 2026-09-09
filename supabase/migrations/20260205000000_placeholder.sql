-- Migration: Unified Identity & Smart Auth Switch
-- 20260205000000_unified_identity.sql

-- 1. Create au_users table
CREATE TABLE IF NOT EXISTS au_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider TEXT NOT NULL CHECK (provider IN ('supabase', 'firebase')),
    provider_uid TEXT NOT NULL,
    email TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(provider, provider_uid)
);

-- 2. Create au_user_profiles table
CREATE TABLE IF NOT EXISTS au_user_profiles (
    user_id UUID PRIMARY KEY REFERENCES au_users(id) ON DELETE CASCADE,
    full_name TEXT,
    avatar_url TEXT,
    tier TEXT DEFAULT 'free',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Trigger to sync Supabase auth.users to au_users
CREATE OR REPLACE FUNCTION sync_supabase_user_to_au_users()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.au_users (id, provider, provider_uid, email, created_at, updated_at)
    VALUES (NEW.id, 'supabase', NEW.id::text, NEW.email, NEW.created_at, NEW.updated_at)
    ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email, updated_at = EXCLUDED.updated_at;

    INSERT INTO public.au_user_profiles (user_id, full_name, avatar_url)
    VALUES (
        NEW.id, 
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
        NEW.raw_user_meta_data->>'avatar_url'
    )
    ON CONFLICT (user_id) DO NOTHING;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created_sync_au ON auth.users;
CREATE TRIGGER on_auth_user_created_sync_au
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION sync_supabase_user_to_au_users();

-- 4. Sync existing Supabase users (Migration)
INSERT INTO public.au_users (id, provider, provider_uid, email, created_at, updated_at)
SELECT id, 'supabase', id::text, email, created_at, updated_at
FROM auth.users
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.au_user_profiles (user_id, full_name, avatar_url)
SELECT 
    id, 
    COALESCE(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name'),
    raw_user_meta_data->>'avatar_url'
FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

-- 5. Add owner_id to data tables and migrate data
-- au_documents
ALTER TABLE au_documents ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES au_users(id);
UPDATE au_documents SET owner_id = user_id WHERE owner_id IS NULL AND user_id IS NOT NULL;
-- For now, we allow owner_id to be nullable during migration, but ideally it should be NOT NULL.
-- Since we migrated all auth.users, all valid user_ids should map.
-- Guest sessions (legacy) might be an issue, but we are moving away from them or mapping them?
-- Plan says: "Map Firebase UID to persistent guest_session_id" -> No, Plan changed to Unified Identity.
-- So we strictly use au_users.id.
-- What about existing Guest Sessions? They are ephemeral. We can ignore or drop them.

-- au_document_chunks
ALTER TABLE au_document_chunks ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES au_users(id);
UPDATE au_document_chunks SET owner_id = user_id WHERE owner_id IS NULL AND user_id IS NOT NULL;

-- au_sessions
ALTER TABLE au_sessions ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES au_users(id);
UPDATE au_sessions SET owner_id = user_id WHERE owner_id IS NULL AND user_id IS NOT NULL;

-- au_messages
ALTER TABLE au_messages ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES au_users(id);
UPDATE au_messages SET owner_id = user_id WHERE owner_id IS NULL AND user_id IS NOT NULL;

-- au_worker_jobs
ALTER TABLE au_worker_jobs ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES au_users(id);
UPDATE au_worker_jobs SET owner_id = user_id WHERE owner_id IS NULL AND user_id IS NOT NULL;

-- 6. RLS Policies Update
-- Enable RLS on new tables
ALTER TABLE au_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE au_user_profiles ENABLE ROW LEVEL SECURITY;

-- au_users policies
CREATE POLICY "Users can view own identity" ON au_users
FOR SELECT USING (id = auth.uid()); -- Only works for Supabase users directly

-- au_user_profiles policies
CREATE POLICY "Users can view own profile" ON au_user_profiles
FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can update own profile" ON au_user_profiles
FOR UPDATE USING (user_id = auth.uid());

-- Update Data Tables RLS (Supabase users only for direct access)
-- Firebase users will access via Edge Functions (Service Role)
-- So we just need to ensure Supabase users can still access their data via auth.uid()
-- Since auth.uid() == owner_id for Supabase users, we can switch to using owner_id

DROP POLICY IF EXISTS "Users can view own documents" ON au_documents;
CREATE POLICY "Users can view own documents" ON au_documents
FOR SELECT USING (owner_id = auth.uid());

DROP POLICY IF EXISTS "Users can insert own documents" ON au_documents;
CREATE POLICY "Users can insert own documents" ON au_documents
FOR INSERT WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own documents" ON au_documents;
CREATE POLICY "Users can update own documents" ON au_documents
FOR UPDATE USING (owner_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own documents" ON au_documents;
CREATE POLICY "Users can delete own documents" ON au_documents
FOR DELETE USING (owner_id = auth.uid());

-- Repeat for other tables
-- au_sessions
DROP POLICY IF EXISTS "Users can view own sessions" ON au_sessions;
CREATE POLICY "Users can view own sessions" ON au_sessions FOR SELECT USING (owner_id = auth.uid());
DROP POLICY IF EXISTS "Users can insert own sessions" ON au_sessions;
CREATE POLICY "Users can insert own sessions" ON au_sessions FOR INSERT WITH CHECK (owner_id = auth.uid());
DROP POLICY IF EXISTS "Users can update own sessions" ON au_sessions;
CREATE POLICY "Users can update own sessions" ON au_sessions FOR UPDATE USING (owner_id = auth.uid());
DROP POLICY IF EXISTS "Users can delete own sessions" ON au_sessions;
CREATE POLICY "Users can delete own sessions" ON au_sessions FOR DELETE USING (owner_id = auth.uid());

-- au_messages
DROP POLICY IF EXISTS "Users can view own messages" ON au_messages;
CREATE POLICY "Users can view own messages" ON au_messages FOR SELECT USING (owner_id = auth.uid());
DROP POLICY IF EXISTS "Users can insert own messages" ON au_messages;
CREATE POLICY "Users can insert own messages" ON au_messages FOR INSERT WITH CHECK (owner_id = auth.uid());

-- au_worker_jobs
DROP POLICY IF EXISTS "Users can see their own worker jobs" ON au_worker_jobs;
CREATE POLICY "Users can see their own worker jobs" ON au_worker_jobs FOR SELECT USING (owner_id = auth.uid());
DROP POLICY IF EXISTS "Users can insert their own worker jobs" ON au_worker_jobs;
CREATE POLICY "Users can insert their own worker jobs" ON au_worker_jobs FOR INSERT WITH CHECK (owner_id = auth.uid());
DROP POLICY IF EXISTS "Users can update their own worker jobs" ON au_worker_jobs;
CREATE POLICY "Users can update their own worker jobs" ON au_worker_jobs FOR UPDATE USING (owner_id = auth.uid());

-- 7. App Sessions Table (For Firebase Users)
CREATE TABLE IF NOT EXISTS au_app_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES au_users(id) ON DELETE CASCADE NOT NULL,
    token_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE au_app_sessions ENABLE ROW LEVEL SECURITY;
-- Only service role accesses this

-- 8. Refresh Schema
NOTIFY pgrst, 'reload schema';
