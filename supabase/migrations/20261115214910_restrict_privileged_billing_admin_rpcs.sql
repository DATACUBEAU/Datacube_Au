-- Restrict high-impact billing and admin SECURITY DEFINER routines to server callers.
-- Conditional checks keep clean local replay compatible with schemas that no longer
-- create legacy manual-payment objects.
DO $$
DECLARE
  v_fn text;
BEGIN
  FOR v_fn IN SELECT unnest(ARRAY[
    'public.approve_manual_payment(uuid,uuid,text)',
    'public.apply_verified_billing_payment(uuid,text,bigint,text,text,timestamptz,jsonb,text,jsonb,text,text,text,text,text,text,text,text,text,text,text,text)',
    'public.apply_plan_transition(uuid,text,text,timestamptz,text,text,text,text,jsonb,jsonb)',
    'public.admin_set_user_plan_override(uuid,text,uuid,text,text,text,text,text)',
    'public.admin_count_auth_users(uuid)',
    'public.admin_list_auth_users(uuid,text,integer,integer)',
    'public.au_admin_db_stats(uuid)'
  ])
  LOOP
    IF to_regprocedure(v_fn) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_fn);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_fn);
      EXECUTE format('ALTER FUNCTION %s SET search_path = pg_catalog, public', v_fn);
    END IF;
  END LOOP;
END;
$$;
