CREATE OR REPLACE FUNCTION public.au_admin_db_stats(p_admin_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_db_size bigint;
  v_active_connections int;
BEGIN
  PERFORM 1
  FROM public.au_admin_sessions
  WHERE id = p_admin_token
    AND is_authenticated = true
    AND updated_at > now() - interval '24 hours'
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid or expired admin session';
  END IF;

  SELECT pg_database_size(current_database()) INTO v_db_size;
  SELECT count(*)::int INTO v_active_connections
  FROM pg_stat_activity
  WHERE datname = current_database();

  RETURN jsonb_build_object(
    'db_size_bytes', v_db_size,
    'active_connections', v_active_connections
  );
END;
$$;
