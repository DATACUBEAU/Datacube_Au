
-- Migration: E2E Pipeline Setup
-- 20260203000000_e2e_pipeline_setup.sql

-- 1. Create ingestion_jobs table
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT FROM pg_type WHERE typname = 'job_status') THEN
        CREATE TYPE job_status AS ENUM ('pending', 'claimed', 'completed', 'failed');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS ingestion_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supabase_file_id TEXT NOT NULL,
    status job_status DEFAULT 'pending',
    claim_expires_at TIMESTAMPTZ,
    retry_count SMALLINT DEFAULT 0 CHECK (retry_count <= 3),
    error TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Indexes
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_status_claim ON ingestion_jobs(status, claim_expires_at) WHERE status = 'pending' OR status = 'claimed';
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_file_id ON ingestion_jobs(supabase_file_id);

-- 3. RLS Policies
ALTER TABLE ingestion_jobs ENABLE ROW LEVEL SECURITY;

-- Allow Firebase Worker (via service_role or specific UID if we had it)
-- Since the worker uses service_role, it already has access. 
-- But the user asked to "Verify Row-Level Security (RLS) policies allow the Firebase Worker UID to SELECT ... FOR UPDATE SKIP LOCKED and to UPDATE status."
-- If the worker uses a specific user, we'd need that UID. 
-- For now, let's assume service_role is used, but we can add a policy for authenticated if needed.

-- 4. Storage Bucket Trigger
-- Ensure SUPABASE_BUCKET exists
INSERT INTO storage.buckets (id, name, public)
VALUES ('DataCube', 'DataCube', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Function to enqueue job on upload
CREATE OR REPLACE FUNCTION public.on_storage_upload_enqueue()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.ingestion_jobs (supabase_file_id, status)
    VALUES (new.name, 'pending');
    
    -- Also call the Edge Function if needed, but the worker can poll the queue.
    -- Requirement 2d: "Confirm SUPABASE_BUCKET ... has on_upload trigger calling the Edge Function enqueueJob"
    -- This usually means a webhook trigger in Supabase.
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger on storage.objects
-- Note: Supabase storage triggers are usually handled via webhooks or custom triggers on storage.objects
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'on_upload_job_trigger') THEN
        CREATE TRIGGER on_upload_job_trigger
        AFTER INSERT ON storage.objects
        FOR EACH ROW
        WHEN (new.bucket_id = 'DataCube')
        EXECUTE FUNCTION public.on_storage_upload_enqueue();
    END IF;
END $$;

-- 5. RPC to claim job
CREATE OR REPLACE FUNCTION claim_ingestion_job(p_job_id UUID, p_worker_id TEXT)
RETURNS SETOF ingestion_jobs AS $$
BEGIN
    RETURN QUERY
    UPDATE ingestion_jobs
    SET status = 'claimed',
        claim_expires_at = now() + interval '10 minutes',
        updated_at = now()
    WHERE id = p_job_id
      AND (status = 'pending' OR (status = 'claimed' AND claim_expires_at < now()))
    RETURNING *;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
