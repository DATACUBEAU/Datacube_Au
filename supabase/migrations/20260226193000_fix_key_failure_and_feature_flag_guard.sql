-- Prevent automatic key deactivation loops and harden set_feature_flag admin checks.

CREATE OR REPLACE FUNCTION public.report_api_key_failure(p_key_value TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.au_api_keys
  SET error_count = COALESCE(error_count, 0) + 1,
      last_used_at = now(),
      updated_at = now()
  WHERE key_value = p_key_value;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_feature_flag(
  p_key TEXT,
  p_enabled BOOLEAN,
  p_category TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_scope TEXT DEFAULT 'global',
  p_config JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_is_admin BOOLEAN := FALSE;
  v_row JSONB;
BEGIN
  IF to_regprocedure('public.is_conex_admin(uuid)') IS NOT NULL THEN
    EXECUTE 'SELECT public.is_conex_admin($1)' INTO v_is_admin USING v_uid;
  ELSE
    v_is_admin := (
      v_uid = '05ad2f16-b3ce-48eb-bf24-41b407556ffd'::uuid
      OR COALESCE((auth.jwt() ->> 'role') = 'service_role', FALSE)
      OR COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = 'service_role', FALSE)
    );
  END IF;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.feature_flags (key, enabled, category, description, scope, config)
  VALUES (
    TRIM(p_key),
    COALESCE(p_enabled, FALSE),
    COALESCE(NULLIF(TRIM(p_category), ''), 'general'),
    COALESCE(p_description, ''),
    CASE WHEN p_scope IN ('global', 'org', 'user') THEN p_scope ELSE 'global' END,
    COALESCE(p_config, '{}'::jsonb)
  )
  ON CONFLICT (key) DO UPDATE
  SET enabled = EXCLUDED.enabled,
      category = EXCLUDED.category,
      description = EXCLUDED.description,
      scope = EXCLUDED.scope,
      config = EXCLUDED.config,
      updated_at = now()
  RETURNING jsonb_build_object(
    'id', id,
    'key', key,
    'enabled', enabled,
    'category', category,
    'description', description,
    'scope', scope,
    'org_id', org_id,
    'user_id', user_id,
    'config', config,
    'updated_at', updated_at
  )
  INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.set_feature_flag(TEXT, BOOLEAN, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_feature_flag(TEXT, BOOLEAN, TEXT, TEXT, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_feature_flag(TEXT, BOOLEAN, TEXT, TEXT, TEXT, JSONB) TO service_role;
