-- Replace broad PUBLIC role targets with authenticated for owner-bound policies.
-- The auth.uid() predicates already scoped rows, but explicit role targeting prevents
-- anonymous roles from entering these policies and makes grants easier to audit.
-- Public active plan catalogs and global feature-flag reads are intentionally retained.

ALTER POLICY "Admin access only" ON public.au_admin_config TO authenticated;
ALTER POLICY "Admin access only" ON public.au_admin_email_alerts TO authenticated;
ALTER POLICY "Admin access only" ON public.au_admin_sessions TO authenticated;
ALTER POLICY "No access for public" ON public.au_api_keys TO authenticated;
ALTER POLICY "Admin access only" ON public.au_debug_logs TO authenticated;
ALTER POLICY "Admin access only" ON public.au_feedback TO authenticated;

ALTER POLICY "Users can view their own auth mappings" ON public.au_auth_mappings TO authenticated;
ALTER POLICY "Users can view their own events" ON public.au_events TO authenticated;
ALTER POLICY "Anyone can insert feedback" ON public.au_feedback TO authenticated;

ALTER POLICY "Users can create manual payments" ON public.au_manual_payments TO authenticated;
ALTER POLICY "Users can submit manual payments" ON public.au_manual_payments TO authenticated;
ALTER POLICY "Users can view own manual payments" ON public.au_manual_payments TO authenticated;
ALTER POLICY "Users can view own payments" ON public.au_payments TO authenticated;
ALTER POLICY "Users can view own subscriptions" ON public.au_subscriptions TO authenticated;
ALTER POLICY "Users can read own usage" ON public.au_usage_daily TO authenticated;

ALTER POLICY "Users can insert their own activity" ON public.au_user_activity TO authenticated;
ALTER POLICY "Users can select their own activity" ON public.au_user_activity TO authenticated;
ALTER POLICY "Users can update their own activity" ON public.au_user_activity TO authenticated;
ALTER POLICY "Users can update own profile" ON public.au_user_profiles TO authenticated;
ALTER POLICY "Users can view own profile" ON public.au_user_profiles TO authenticated;
ALTER POLICY "Users can view own identity" ON public.au_users TO authenticated;

ALTER POLICY "feature_flags_read_by_scope" ON public.feature_flags TO authenticated;
ALTER POLICY "Users can insert/update own memory summaries" ON public.memory_summaries TO authenticated;
ALTER POLICY "Users can read own memory summaries" ON public.memory_summaries TO authenticated;
