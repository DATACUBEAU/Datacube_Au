BEGIN;

SELECT status, worker_id, COUNT(*) AS job_count
FROM public.au_worker_jobs
GROUP BY status, worker_id
ORDER BY status, worker_id;

UPDATE public.au_worker_jobs
SET
  worker_id = 'vps-worker',
  metadata = COALESCE(metadata, '{}'::jsonb) - 'pipeline',
  updated_at = now()
WHERE worker_id = 'firebase-worker'
  AND status IN ('queued', 'uploaded');

UPDATE public.au_worker_jobs
SET
  worker_id = 'vps-worker',
  status = 'queued',
  progress = 0,
  locked_at = NULL,
  locked_until = NULL,
  claimed_by = NULL,
  retry_count = COALESCE(retry_count, 0) + 1,
  metadata = COALESCE(metadata, '{}'::jsonb) - 'pipeline',
  updated_at = now()
WHERE worker_id = 'firebase-worker'
  AND status = 'processing'
  AND (locked_until IS NULL OR locked_until < now());

UPDATE public.au_worker_jobs
SET
  worker_id = 'vps-worker',
  metadata = COALESCE(metadata, '{}'::jsonb) - 'pipeline',
  updated_at = now()
WHERE worker_id IS NULL
  AND status IN ('queued', 'uploaded');

SELECT status, worker_id, COUNT(*) AS job_count
FROM public.au_worker_jobs
GROUP BY status, worker_id
ORDER BY status, worker_id;

COMMIT;
