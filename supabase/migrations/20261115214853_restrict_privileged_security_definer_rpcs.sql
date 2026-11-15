-- Close browser-executable SECURITY DEFINER paths that mutate billing, plans,
-- account cleanup or privileged metadata. Trigger functions remain callable by
-- PostgreSQL triggers without granting EXECUTE to API roles.

REVOKE ALL PRIVILEGES ON FUNCTION public.admin_set_user_plan_override(uuid,text,uuid,text,text,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_user_plan_override(uuid,text,uuid,text,text,text,text,text)
  TO service_role;

REVOKE ALL PRIVILEGES ON FUNCTION public.apply_plan_transition(uuid,text,text,timestamptz,text,text,text,text,jsonb,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_plan_transition(uuid,text,text,timestamptz,text,text,text,text,jsonb,jsonb)
  TO service_role;

REVOKE ALL PRIVILEGES ON FUNCTION public.apply_verified_billing_payment(uuid,text,bigint,text,text,timestamptz,jsonb,text,jsonb,text,text,text,text,text,text,text,text,text,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_verified_billing_payment(uuid,text,bigint,text,text,timestamptz,jsonb,text,jsonb,text,text,text,text,text,text,text,text,text,text,text,text)
  TO service_role;

REVOKE ALL PRIVILEGES ON FUNCTION public.approve_manual_payment(uuid,uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_manual_payment(uuid,uuid,text)
  TO service_role;

REVOKE ALL PRIVILEGES ON FUNCTION public.cleanup_inactive_accounts()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_inactive_accounts()
  TO service_role;

REVOKE ALL PRIVILEGES ON FUNCTION public.au_rate_limit_hit(text,uuid,text,text,timestamptz,integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.au_rate_limit_hit(text,uuid,text,text,timestamptz,integer)
  TO service_role;

-- These are trigger-only helpers. PostgreSQL does not require the triggering
-- API role to hold EXECUTE on the trigger function.
REVOKE ALL PRIVILEGES ON FUNCTION public.decide_auth_executor(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.ensure_user_consistency() FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.protect_platform_owner_auth_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.protect_platform_owner_billing_row() FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.protect_platform_owner_entitlement() FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.protect_platform_owner_profile() FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.protect_platform_owner_row_delete() FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.set_au_user_profile_username_normalized() FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.sync_supabase_user_to_au_users() FROM PUBLIC, anon, authenticated;

-- Cross-account read helpers have internal auth.uid() checks for authenticated
-- callers, but anonymous callers have no requester identity to compare.
REVOKE ALL PRIVILEGES ON FUNCTION public.get_effective_entitlements(uuid) FROM anon;
REVOKE ALL PRIVILEGES ON FUNCTION public.get_effective_limits(uuid) FROM anon;
REVOKE ALL PRIVILEGES ON FUNCTION public.get_usage_metric_window_totals(uuid,text[],timestamptz,timestamptz) FROM anon;
REVOKE ALL PRIVILEGES ON FUNCTION public.is_conex_admin(uuid) FROM anon;

-- Admin-session RPCs already validate the supplied admin session inside the
-- function; remove anonymous execution while retaining authenticated admin use.
REVOKE ALL PRIVILEGES ON FUNCTION public.admin_count_auth_users(uuid) FROM anon;
REVOKE ALL PRIVILEGES ON FUNCTION public.admin_list_auth_users(uuid,text,integer,integer) FROM anon;
REVOKE ALL PRIVILEGES ON FUNCTION public.au_admin_db_stats(uuid) FROM anon;
REVOKE ALL PRIVILEGES ON FUNCTION public.set_feature_flag(text,boolean,text,text,text,jsonb) FROM anon;
