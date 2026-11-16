-- Preserve the legacy admin-session RPC contract where those routines exist.
DO $$
DECLARE v_fn text;
BEGIN
  FOR v_fn IN SELECT unnest(ARRAY[
    'public.admin_count_auth_users(uuid)',
    'public.admin_list_auth_users(uuid,text,integer,integer)',
    'public.au_admin_db_stats(uuid)',
    'public.set_feature_flag(text,boolean,text,text,text,jsonb)'
  ])
  LOOP
    IF to_regprocedure(v_fn) IS NOT NULL THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', v_fn);
    END IF;
  END LOOP;
END;
$$;
