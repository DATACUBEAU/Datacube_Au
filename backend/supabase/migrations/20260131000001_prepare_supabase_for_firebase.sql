-- Migration: Prepare Supabase for Firebase Worker Integration
-- 20260131000001_prepare_supabase_for_firebase.sql

-- 1. Adjust au_worker_jobs table to match requested structure
DO $$ 
BEGIN
    -- Rename error to error_message if it exists
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='au_worker_jobs' AND column_name='error') THEN
        ALTER TABLE au_worker_jobs RENAME COLUMN error TO error_message;
    END IF;

    -- Rename metadata to payload if it exists
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='au_worker_jobs' AND column_name='metadata') THEN
        ALTER TABLE au_worker_jobs RENAME COLUMN metadata TO payload;
    END IF;

    -- Add started_at and completed_at
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='au_worker_jobs' AND column_name='started_at') THEN
        ALTER TABLE au_worker_jobs ADD COLUMN started_at TIMESTAMPTZ;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='au_worker_jobs' AND column_name='completed_at') THEN
        ALTER TABLE au_worker_jobs ADD COLUMN completed_at TIMESTAMPTZ;
    END IF;

    -- Update status check constraint if it exists
    -- First, remove the old constraint
    ALTER TABLE au_worker_jobs DROP CONSTRAINT IF EXISTS au_worker_jobs_status_check;
    
    -- Add the new constraint with 'pending'
    ALTER TABLE au_worker_jobs ADD CONSTRAINT au_worker_jobs_status_check 
    CHECK (status IN ('pending', 'processing', 'completed', 'failed'));

    -- Update existing 'queued' status to 'pending'
    UPDATE au_worker_jobs SET status = 'pending' WHERE status = 'queued';
    
    -- Set default status to 'pending'
    ALTER TABLE au_worker_jobs ALTER COLUMN status SET DEFAULT 'pending';
END $$;

-- 2. Ensure au_debug_logs has document_id
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='au_debug_logs' AND column_name='document_id') THEN
        ALTER TABLE au_debug_logs ADD COLUMN document_id UUID REFERENCES au_documents(id) ON DELETE CASCADE;
    END IF;
END $$;

-- 3. Notify schema reload
NOTIFY pgrst, 'reload schema';
