-- Remove only exact duplicate indexes and policies. Application data is untouched.
DROP INDEX IF EXISTS public.idx_au_admin_email_alerts_event_type;
DROP INDEX IF EXISTS public.idx_au_model_usage_created_at_desc;

DROP POLICY IF EXISTS "Service role can access keys" ON public.au_api_keys;
DROP POLICY IF EXISTS "Service role only" ON public.au_api_keys;

DROP POLICY IF EXISTS "Users can view own quota windows" ON public.au_quota_windows;

DROP POLICY IF EXISTS "Users can insert own activity" ON public.au_user_activity;
DROP POLICY IF EXISTS "Users can view own activity" ON public.au_user_activity;
DROP POLICY IF EXISTS "Users can update own activity" ON public.au_user_activity;
