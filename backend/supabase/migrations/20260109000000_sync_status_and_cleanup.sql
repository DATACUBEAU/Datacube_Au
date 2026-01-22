-- 1. Trigger to sync status from au_upload_jobs to au_documents
CREATE OR REPLACE FUNCTION public.sync_document_status_from_job()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'UPDATE') THEN
        IF NEW.status = 'done' THEN
            UPDATE public.au_documents
            SET status = 'completed',
                updated_at = now()
            WHERE id = NEW.document_id;
        ELSIF NEW.status = 'failed' THEN
            UPDATE public.au_documents
            SET status = 'failed',
                error = NEW.error,
                updated_at = now()
            WHERE id = NEW.document_id;
        ELSIF NEW.status = 'processing' THEN
            UPDATE public.au_documents
            SET status = 'processing',
                updated_at = now()
            WHERE id = NEW.document_id;
        ELSIF NEW.status = 'uploading' THEN
            UPDATE public.au_documents
            SET status = 'uploading',
                updated_at = now()
            WHERE id = NEW.document_id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tr_sync_document_status ON public.au_upload_jobs;
CREATE TRIGGER tr_sync_document_status
AFTER UPDATE OF status ON public.au_upload_jobs
FOR EACH ROW
EXECUTE FUNCTION public.sync_document_status_from_job();

-- 2. Cleanup function for stuck documents
CREATE OR REPLACE FUNCTION public.cleanup_stuck_documents()
RETURNS json AS $$
DECLARE
    affected_docs_count integer;
    affected_jobs_count integer;
BEGIN
    -- Mark documents as failed if they are stuck in processing/uploading for > 1 hour
    WITH stuck_docs AS (
        UPDATE public.au_documents
        SET status = 'failed',
            error = 'Processing timeout (stuck for > 1 hour)',
            updated_at = now()
        WHERE status IN ('processing', 'uploading')
          AND updated_at < (now() - interval '1 hour')
        RETURNING id
    )
    SELECT count(*) INTO affected_docs_count FROM stuck_docs;

    -- Also mark corresponding jobs as failed if they are stuck
    WITH stuck_jobs AS (
        UPDATE public.au_upload_jobs
        SET status = 'failed',
            error = 'Job timeout (stuck for > 1 hour)',
            updated_at = now()
        WHERE status IN ('processing', 'uploading', 'queued')
          AND updated_at < (now() - interval '1 hour')
        RETURNING id
    )
    SELECT count(*) INTO affected_jobs_count FROM stuck_jobs;

    RETURN json_build_object(
        'affected_documents', affected_docs_count,
        'affected_jobs', affected_jobs_count,
        'timestamp', now()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Note: To automate this, the user can enable pg_cron in Supabase and run:
-- SELECT cron.schedule('cleanup-stuck-docs', '0 * * * *', 'SELECT public.cleanup_stuck_documents()');
