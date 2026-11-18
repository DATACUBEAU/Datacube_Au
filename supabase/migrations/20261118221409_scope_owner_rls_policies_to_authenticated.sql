-- Replace broad PUBLIC role targets with authenticated for owner-bound policies.
-- The auth.uid() predicates already scoped rows, but explicit role targeting prevents
-- anonymous roles from entering these policies and makes grants easier to audit.
-- Public active plan catalogs and global feature-flag reads are intentionally retained.
-- Earlier migrations may omit optional legacy tables or policies. Missing policies
-- remain closed by RLS; existing policies are narrowed to authenticated.

DO $$
DECLARE
  policy_scope record;
BEGIN
  FOR policy_scope IN
    SELECT *
    FROM (VALUES
      ('au_admin_config', 'Admin access only'),
      ('au_admin_email_alerts', 'Admin access only'),
      ('au_admin_sessions', 'Admin access only'),
      ('au_api_keys', 'No access for public'),
      ('au_debug_logs', 'Admin access only'),
      ('au_feedback', 'Admin access only'),
      ('au_auth_mappings', 'Users can view their own auth mappings'),
      ('au_events', 'Users can view their own events'),
      ('au_feedback', 'Anyone can insert feedback'),
      ('au_manual_payments', 'Users can create manual payments'),
      ('au_manual_payments', 'Users can submit manual payments'),
      ('au_manual_payments', 'Users can view own manual payments'),
      ('au_payments', 'Users can view own payments'),
      ('au_subscriptions', 'Users can view own subscriptions'),
      ('au_usage_daily', 'Users can read own usage'),
      ('au_user_activity', 'Users can insert their own activity'),
      ('au_user_activity', 'Users can select their own activity'),
      ('au_user_activity', 'Users can update their own activity'),
      ('au_user_profiles', 'Users can update own profile'),
      ('au_user_profiles', 'Users can view own profile'),
      ('au_users', 'Users can view own identity'),
      ('feature_flags', 'feature_flags_read_by_scope'),
      ('memory_summaries', 'Users can insert/update own memory summaries'),
      ('memory_summaries', 'Users can read own memory summaries')
    ) AS scopes(table_name, policy_name)
  LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = policy_scope.table_name
        AND policyname = policy_scope.policy_name
    ) THEN
      EXECUTE format(
        'ALTER POLICY %I ON %I.%I TO authenticated',
        policy_scope.policy_name,
        'public',
        policy_scope.table_name
      );
    END IF;
  END LOOP;
END
$$;
