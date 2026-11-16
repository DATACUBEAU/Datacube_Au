-- Close browser-executable SECURITY DEFINER paths that mutate billing, plans,
-- account cleanup or privileged metadata. Keep the migration replayable when a
-- legacy routine is absent from a clean local schema.
DO $$
DECLARE
  v_fn text;
BEGIN
  FOR v_fn IN SELECT unnest(ARRAY[
    'public.admin_set_user_plan_override(uuid,text,uuid,text,text,text,text,text)',
    'public.apply_plan_transition(uuid,text,text,timestamptz,text,text,text,text,jsonb,jsonb)',
    'public.apply_verified_billing_payment(uuid,text,bigint,text,text,timestamptz,jsonb,text,jsonb,text,text,text,text,text,text,text,text,text,text,text,text)',
    'public.approve_manual_payment(uuid,uuid,text)',
    'public.cleanup_inactive_accounts()',
    'public.au_rate_limit_hit(text,uuid,text,text,timestamptz,integer)',
    'public.decide_auth_executor(uuid)',
    'public.protect_platform_owner_auth_user()',
    'public.protect_platform_owner_billing_row()',
    'public.protect_platform_owner_entitlement()',
    'public.protect_platform_owner_profile()',
    'public.protect_platform_owner_row_delete()',
    'public.set_au_user_profile_username_normalized()',
    'public.sync_supabase_user_to_au_users()'
  ])
  LOOP
    IF to_regprocedure(v_fn) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_fn);
    END IF;
  END LOOP;

  FOR v_fn IN SELECT unnest(ARRAY[
    'public.admin_set_user_plan_override(uuid,text,uuid,text,text,text,text,text)',
    'public.apply_plan_transition(uuid,text,text,timestamptz,text,text,text,text,jsonb,jsonb)',
    'public.apply_verified_billing_payment(uuid,text,bigint,text,text,timestamptz,jsonb,text,jsonb,text,text,text,text,text,text,text,text,text,text,text,text)',
    'public.approve_manual_payment(uuid,uuid,text)',
    'public.cleanup_inactive_accounts()',
    'public.au_rate_limit_hit(text,uuid,text,text,timestamptz,integer)',
    'public.decide_auth_executor(uuid)'
  ])
  LOOP
    IF to_regprocedure(v_fn) IS NOT NULL THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_fn);
    END IF;
  END LOOP;

  FOR v_fn IN SELECT unnest(ARRAY[
    'public.get_effective_entitlements(uuid)',
    'public.get_effective_limits(uuid)',
    'public.get_usage_metric_window_totals(uuid,text[],timestamptz,timestamptz)',
    'public.is_conex_admin(uuid)',
    'public.admin_count_auth_users(uuid)',
    'public.admin_list_auth_users(uuid,text,integer,integer)',
    'public.au_admin_db_stats(uuid)',
    'public.set_feature_flag(text,boolean,text,text,text,jsonb)'
  ])
  LOOP
    IF to_regprocedure(v_fn) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION %s FROM anon', v_fn);
    END IF;
  END LOOP;

  -- This helper deliberately operates only on auth.uid() and is used by the
  -- signed-in user's account bootstrap. Preserve authenticated execution.
  IF to_regprocedure('public.ensure_user_consistency()') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL PRIVILEGES ON FUNCTION public.ensure_user_consistency() FROM PUBLIC, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.ensure_user_consistency() TO authenticated';
  END IF;
END;
$$;
