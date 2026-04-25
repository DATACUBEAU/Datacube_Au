CREATE OR REPLACE FUNCTION public.admin_count_auth_users(p_admin_token uuid)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_count bigint;
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

  SELECT count(*) INTO v_count
  FROM auth.users;

  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_auth_users(
  p_admin_token uuid,
  p_q text DEFAULT NULL,
  p_page int DEFAULT 1,
  p_page_size int DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_offset int;
  v_limit int;
  v_total bigint;
  v_users jsonb;
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

  v_limit := LEAST(200, GREATEST(1, COALESCE(p_page_size, 50)));
  v_offset := GREATEST(0, (GREATEST(1, COALESCE(p_page, 1)) - 1) * v_limit);

  WITH base AS (
    SELECT
      u.id,
      u.email,
      u.created_at,
      u.last_sign_in_at,
      u.raw_user_meta_data
    FROM auth.users u
    WHERE
      (p_q IS NULL OR btrim(p_q) = '' OR
       lower(coalesce(u.email, '')) LIKE '%' || lower(p_q) || '%' OR
       lower(u.id::text) LIKE '%' || lower(p_q) || '%')
  ),
  tot AS (
    SELECT count(*)::bigint AS c FROM base
  ),
  paged AS (
    SELECT *
    FROM base
    ORDER BY created_at DESC
    OFFSET v_offset
    LIMIT v_limit
  )
  SELECT c INTO v_total FROM tot;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'user_id', p.id,
        'email', p.email,
        'created_at', p.created_at,
        'last_sign_in_at', p.last_sign_in_at,
        'provider', 'supabase',
        'full_name', coalesce(
          p.raw_user_meta_data->>'full_name',
          p.raw_user_meta_data->>'name',
          nullif(split_part(coalesce(p.email, ''), '@', 1), '')
        )
      )
    ),
    '[]'::jsonb
  )
  INTO v_users
  FROM paged p;

  RETURN jsonb_build_object(
    'users', v_users,
    'total', v_total,
    'page', GREATEST(1, COALESCE(p_page, 1)),
    'pageSize', v_limit
  );
END;
$$;
