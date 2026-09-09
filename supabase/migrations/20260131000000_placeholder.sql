-- Migration: Worker Jobs System for Firebase Integration
-- 20260131000000_worker_jobs_system.sql

-- 1. Create au_worker_jobs table to track background processing
CREATE TABLE IF NOT EXISTS au_worker_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID REFERENCES au_documents(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    guest_session_id UUID,
    status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
    progress INTEGER DEFAULT 0,
    worker_id TEXT DEFAULT 'firebase-worker',
    error TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE au_worker_jobs ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Admins can do everything on au_worker_jobs" 
ON au_worker_jobs FOR ALL 
TO service_role 
USING (true) 
WITH CHECK (true);

CREATE POLICY "Users can see their own worker jobs" 
ON au_worker_jobs FOR SELECT 
TO authenticated 
USING (auth.uid() = user_id);

CREATE POLICY "Guests can see their own worker jobs" 
ON au_worker_jobs FOR SELECT 
TO anon 
USING (guest_session_id IS NOT NULL);

-- 2. Indexes for performance
CREATE INDEX IF NOT EXISTS idx_worker_jobs_document_id ON au_worker_jobs(document_id);
CREATE INDEX IF NOT EXISTS idx_worker_jobs_status ON au_worker_jobs(status);
CREATE INDEX IF NOT EXISTS idx_worker_jobs_created_at ON au_worker_jobs(created_at DESC);

-- 3. Notify schema reload
NOTIFY pgrst, 'reload schema';
