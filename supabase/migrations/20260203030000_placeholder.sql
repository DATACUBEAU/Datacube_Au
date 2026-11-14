-- Migration: Finalize Worker Jobs and Remove Upload Jobs
-- 20260203030000_finalize_worker_jobs.sql

-- 1. Add missing columns to au_worker_jobs to support frontend and full metadata
ALTER TABLE au_worker_jobs 
ADD COLUMN IF NOT EXISTS file_name TEXT,
ADD COLUMN IF NOT EXISTS mime_type TEXT,
ADD COLUMN IF NOT EXISTS file_size_bytes BIGINT,
ADD COLUMN IF NOT EXISTS label TEXT,
ADD COLUMN IF NOT EXISTS tus_url TEXT;

-- 2. Update status check constraint for au_worker_jobs to support frontend statuses
ALTER TABLE au_worker_jobs DROP CONSTRAINT IF EXISTS au_worker_jobs_status_check;
ALTER TABLE au_worker_jobs ADD CONSTRAINT au_worker_jobs_status_check 
CHECK (status IN ('queued', 'uploading', 'uploaded', 'processing', 'completed', 'failed', 'cancelled'));

-- 3. Ensure RLS policies for au_worker_jobs support all actions
DROP POLICY IF EXISTS "Users can see their own worker jobs" ON au_worker_jobs;
CREATE POLICY "Users can see their own worker jobs" 
ON au_worker_jobs FOR SELECT 
TO authenticated 
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own worker jobs" ON au_worker_jobs;
CREATE POLICY "Users can insert their own worker jobs" 
ON au_worker_jobs FOR INSERT 
TO authenticated 
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own worker jobs" ON au_worker_jobs;
CREATE POLICY "Users can update their own worker jobs" 
ON au_worker_jobs FOR UPDATE 
TO authenticated 
USING (auth.uid() = user_id);

-- Guest policies
DROP POLICY IF EXISTS "Guests can see their own worker jobs" ON au_worker_jobs;
CREATE POLICY "Guests can see their own worker jobs" 
ON au_worker_jobs FOR SELECT 
TO anon 
USING (guest_session_id IS NOT NULL);

DROP POLICY IF EXISTS "Guests can insert their own worker jobs" ON au_worker_jobs;
CREATE POLICY "Guests can insert their own worker jobs" 
ON au_worker_jobs FOR INSERT 
TO anon 
WITH CHECK (guest_session_id IS NOT NULL);

-- 4. Remove the old au_upload_jobs table
DROP TABLE IF EXISTS au_upload_jobs;

-- 5. Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
