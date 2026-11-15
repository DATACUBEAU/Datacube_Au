-- Reassert the server-only boundary for legacy admin data RPCs.
DO $$
DECLARE v_fn text;
BEGIN
  FOR v_fn IN SELECT unnest(ARRAY[
    'public.admin_count_auth_users(uuid)',
    'public.admin_list_auth_users(uuid,text,integer,integer)',
    'public.au_admin_db_stats(uuid)'
  ])
  LOOP
    IF to_regprocedure(v_fn) IS NOT NULL THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', v_fn);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_fn);
    END IF;
  END LOOP;
END;
$$;
