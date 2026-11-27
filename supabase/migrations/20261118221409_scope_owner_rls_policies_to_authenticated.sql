-- Recovered production ledger version; original SQL archived under docs/audits/migration-ledger-originals.
-- Historical installations may lack legacy relations/policies; do not recreate retired objects.
-- Existing objects receive the same policy changes as the production ledger.
DO $p0_replay$
BEGIN
  IF to_regclass('public.au_admin_config') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'au_admin_config' AND policyname = 'Admin access only') THEN
    ALTER POLICY "Admin access only" ON public.au_admin_config TO authenticated;
  END IF;

  IF to_regclass('public.au_admin_email_alerts') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'au_admin_email_alerts' AND policyname = 'Admin access only') THEN
    ALTER POLICY "Admin access only" ON public.au_admin_email_alerts TO authenticated;
  END IF;

  IF to_regclass('public.au_admin_sessions') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'au_admin_sessions' AND policyname = 'Admin access only') THEN
    ALTER POLICY "Admin access only" ON public.au_admin_sessions TO authenticated;
  END IF;

  IF to_regclass('public.au_api_keys') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'au_api_keys' AND policyname = 'No access for public') THEN
    ALTER POLICY "No access for public" ON public.au_api_keys TO authenticated;
  END IF;

  IF to_regclass('public.au_debug_logs') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'au_debug_logs' AND policyname = 'Admin access only') THEN
    ALTER POLICY "Admin access only" ON public.au_debug_logs TO authenticated;
  END IF;

  IF to_regclass('public.au_feedback') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'au_feedback' AND policyname = 'Admin access only') THEN
    ALTER POLICY "Admin access only" ON public.au_feedback TO authenticated;
  END IF;

  IF to_regclass('public.au_auth_mappings') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'au_auth_mappings' AND policyname = 'Users can view their own auth mappings') THEN
    ALTER POLICY "Users can view their own auth mappings" ON public.au_auth_mappings TO authenticated;
  END IF;

  IF to_regclass('public.au_events') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'au_events' AND policyname = 'Users can view their own events') THEN
    ALTER POLICY "Users can view their own events" ON public.au_events TO authenticated;
  END IF;

  IF to_regclass('public.au_feedback') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'au_feedback' AND policyname = 'Anyone can insert feedback') THEN
    ALTER POLICY "Anyone can insert feedback" ON public.au_feedback TO authenticated;
  END IF;

  IF to_regclass('public.au_manual_payments') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'au_manual_payments' AND policyname = 'Users can create manual payments') THEN
    ALTER POLICY "Users can create manual payments" ON public.au_manual_payments TO authenticated;
  END IF;

  IF to_regclass('public.au_manual_payments') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'au_manual_payments' AND policyname = 'Users can submit manual payments') THEN
    ALTER POLICY "Users can submit manual payments" ON public.au_manual_payments TO authenticated;
  END IF;

  IF to_regclass('public.au_manual_payments') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'au_manual_payments' AND policyname = 'Users can view own manual payments') THEN
    ALTER POLICY "Users can view own manual payments" ON public.au_manual_payments TO authenticated;
  END IF;

  IF to_regclass('public.au_payments') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'au_payments' AND policyname = 'Users can view own payments') THEN
    ALTER POLICY "Users can view own payments" ON public.au_payments TO authenticated;
  END IF;

  IF to_regclass('public.au_subscriptions') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'au_subscriptions' AND policyname = 'Users can view own subscriptions') THEN
    ALTER POLICY "Users can view own subscriptions" ON public.au_subscriptions TO authenticated;
  END IF;

  IF to_regclass('public.au_usage_daily') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'au_usage_daily' AND policyname = 'Users can read own usage') THEN
    ALTER POLICY "Users can read own usage" ON public.au_usage_daily TO authenticated;
  END IF;

  IF to_regclass('public.au_user_activity') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'au_user_activity' AND policyname = 'Users can insert their own activity') THEN
    ALTER POLICY "Users can insert their own activity" ON public.au_user_activity TO authenticated;
  END IF;

  IF to_regclass('public.au_user_activity') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'au_user_activity' AND policyname = 'Users can select their own activity') THEN
    ALTER POLICY "Users can select their own activity" ON public.au_user_activity TO authenticated;
  END IF;

  IF to_regclass('public.au_user_activity') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'au_user_activity' AND policyname = 'Users can update their own activity') THEN
    ALTER POLICY "Users can update their own activity" ON public.au_user_activity TO authenticated;
  END IF;

  IF to_regclass('public.au_user_profiles') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'au_user_profiles' AND policyname = 'Users can update own profile') THEN
    ALTER POLICY "Users can update own profile" ON public.au_user_profiles TO authenticated;
  END IF;

  IF to_regclass('public.au_user_profiles') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'au_user_profiles' AND policyname = 'Users can view own profile') THEN
    ALTER POLICY "Users can view own profile" ON public.au_user_profiles TO authenticated;
  END IF;

  IF to_regclass('public.au_users') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'au_users' AND policyname = 'Users can view own identity') THEN
    ALTER POLICY "Users can view own identity" ON public.au_users TO authenticated;
  END IF;

  IF to_regclass('public.feature_flags') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'feature_flags' AND policyname = 'feature_flags_read_by_scope') THEN
    ALTER POLICY "feature_flags_read_by_scope" ON public.feature_flags TO authenticated;
  END IF;

  IF to_regclass('public.memory_summaries') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'memory_summaries' AND policyname = 'Users can insert/update own memory summaries') THEN
    ALTER POLICY "Users can insert/update own memory summaries" ON public.memory_summaries TO authenticated;
  END IF;

  IF to_regclass('public.memory_summaries') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'memory_summaries' AND policyname = 'Users can read own memory summaries') THEN
    ALTER POLICY "Users can read own memory summaries" ON public.memory_summaries TO authenticated;
  END IF;
END;
$p0_replay$;
