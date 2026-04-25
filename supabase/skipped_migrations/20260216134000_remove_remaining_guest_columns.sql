DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT policyname, schemaname, tablename
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('au_worker_jobs', 'au_debug_logs', 'au_feedback', 'au_answer_cache')
      AND (
        coalesce(qual, '') ILIKE '%guest_session_id%'
        OR coalesce(with_check, '') ILIKE '%guest_session_id%'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

ALTER TABLE IF EXISTS public.au_worker_jobs DROP COLUMN IF EXISTS guest_session_id;
ALTER TABLE IF EXISTS public.au_debug_logs DROP COLUMN IF EXISTS guest_session_id;
ALTER TABLE IF EXISTS public.au_feedback DROP COLUMN IF EXISTS guest_session_id;
ALTER TABLE IF EXISTS public.au_answer_cache DROP COLUMN IF EXISTS guest_session_id;

ALTER TABLE IF EXISTS public.au_worker_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own worker jobs" ON public.au_worker_jobs;
DROP POLICY IF EXISTS "Users can insert own worker jobs" ON public.au_worker_jobs;
DROP POLICY IF EXISTS "Users can update own worker jobs" ON public.au_worker_jobs;
DROP POLICY IF EXISTS "Users can delete own worker jobs" ON public.au_worker_jobs;

CREATE POLICY "Users can view own worker jobs" ON public.au_worker_jobs
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own worker jobs" ON public.au_worker_jobs
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own worker jobs" ON public.au_worker_jobs
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own worker jobs" ON public.au_worker_jobs
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

NOTIFY pgrst, 'reload schema';
