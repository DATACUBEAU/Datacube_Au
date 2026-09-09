-- Enforce a database-level trust boundary between ingestion queue rows and
-- their canonical document/storage source. The RAG worker uses service-role
-- storage access, so a malformed queue row must not be able to redirect it to
-- another tenant's object even if that row was created by a trusted backend.

CREATE OR REPLACE FUNCTION public.enforce_worker_job_document_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_document_owner text;
  v_document_path text;
  v_document_bucket text;
  v_job_owner text;
BEGIN
  SELECT
    d.user_id::text,
    NULLIF(btrim(d.file_path), ''),
    COALESCE(NULLIF(btrim(d.bucket), ''), 'documents')
  INTO
    v_document_owner,
    v_document_path,
    v_document_bucket
  FROM public.au_documents AS d
  WHERE d.id = NEW.document_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'worker_job_document_not_found'
      USING ERRCODE = '23503';
  END IF;

  v_job_owner := COALESCE(
    NULLIF(btrim(NEW.owner_id::text), ''),
    NULLIF(btrim(NEW.user_id::text), '')
  );

  IF v_job_owner IS NULL OR v_job_owner <> v_document_owner THEN
    RAISE EXCEPTION 'worker_job_owner_mismatch'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.owner_id IS NOT NULL AND NEW.owner_id::text <> v_document_owner THEN
    RAISE EXCEPTION 'worker_job_owner_id_mismatch'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.user_id IS NOT NULL AND NEW.user_id::text <> v_document_owner THEN
    RAISE EXCEPTION 'worker_job_user_id_mismatch'
      USING ERRCODE = '42501';
  END IF;

  IF v_document_path IS NULL
     OR NULLIF(btrim(NEW.object_path), '') IS DISTINCT FROM v_document_path THEN
    RAISE EXCEPTION 'worker_job_object_path_mismatch'
      USING ERRCODE = '42501';
  END IF;

  IF COALESCE(NULLIF(btrim(NEW.bucket), ''), 'documents') IS DISTINCT FROM v_document_bucket THEN
    RAISE EXCEPTION 'worker_job_bucket_mismatch'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_worker_job_document_source() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_worker_job_document_source() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_worker_job_document_source() TO service_role;

DROP TRIGGER IF EXISTS trg_enforce_worker_job_document_source ON public.au_worker_jobs;
CREATE TRIGGER trg_enforce_worker_job_document_source
BEFORE INSERT OR UPDATE OF status, document_id, owner_id, user_id, bucket, object_path
ON public.au_worker_jobs
FOR EACH ROW
EXECUTE FUNCTION public.enforce_worker_job_document_source();

-- Clean-rebuild invariant: the canonical-source guard must exist and stay
-- attached to the queue table. Migration-chain validation will fail loudly if
-- a later migration removes it accidentally.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger AS t
    JOIN pg_class AS c ON c.oid = t.tgrelid
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'au_worker_jobs'
      AND t.tgname = 'trg_enforce_worker_job_document_source'
      AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'worker job canonical-source trigger is missing';
  END IF;
END
$$;