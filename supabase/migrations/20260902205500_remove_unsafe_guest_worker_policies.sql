-- Remove legacy anonymous worker-job policies that are not tenant/session isolated.
-- The historical policies only required guest_session_id IS NOT NULL, which allowed
-- one anonymous client to read another guest's worker-job metadata and to enqueue
-- rows for arbitrary guest_session_id values. Current guest/Firebase access is
-- expected to traverse trusted server-side paths rather than direct PostgREST RLS.

DROP POLICY IF EXISTS "Guests can see their own worker jobs" ON public.au_worker_jobs;
DROP POLICY IF EXISTS "Guests can insert their own worker jobs" ON public.au_worker_jobs;

-- Keep the clean-rebuild quality gate as an executable regression check for this
-- isolation invariant. If either legacy policy is reintroduced later, replay fails.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'au_worker_jobs'
      AND policyname IN (
        'Guests can see their own worker jobs',
        'Guests can insert their own worker jobs'
      )
  ) THEN
    RAISE EXCEPTION 'unsafe anonymous au_worker_jobs policy remains in final schema';
  END IF;
END
$$;

NOTIFY pgrst, 'reload schema';
