BEGIN;

CREATE OR REPLACE FUNCTION public.get_effective_limits(p_user_id UUID DEFAULT auth.uid())
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requester UUID := auth.uid();
  v_role TEXT := COALESCE(current_setting('request.jwt.claim.role', true), '');
  v_now TIMESTAMPTZ := now();
  v_effective_plan TEXT := 'free';
  v_plan_source TEXT := 'default';
  v_entitlement_source TEXT := 'none';
  v_expires_at TIMESTAMPTZ := NULL;
  v_profile_tier TEXT := 'free';
  v_profile_plan TEXT := NULL;
  v_mirrored_plan TEXT := NULL;
  v_mirrored_source TEXT := 'none';
  v_mirrored_expires_at TIMESTAMPTZ := NULL;
  v_entitlements JSONB := '{}'::jsonb;
  v_has_pro BOOLEAN := FALSE;
  v_entitlement_plan TEXT := NULL;
  v_has_paid_billing_plan BOOLEAN := FALSE;
  v_has_promo_access BOOLEAN := FALSE;
  v_legacy_limits JSONB := '{}'::jsonb;
  v_profile_overrides JSONB := '{}'::jsonb;
  v_seed_limits JSONB := '{}'::jsonb;
  v_fallback_canonical JSONB := '{}'::jsonb;
  v_canonical_limits JSONB := '{}'::jsonb;
  v_limits JSONB := '{}'::jsonb;
  v_usage JSONB := '{}'::jsonb;
  v_retention_days INT := 14;
BEGIN
  IF p_user_id IS NULL THEN
    p_user_id := v_requester;
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  IF v_role <> 'service_role'
     AND v_requester IS NOT NULL
     AND p_user_id <> v_requester
     AND NOT public.is_conex_admin(v_requester) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT LOWER(COALESCE(tier, 'free'))
  INTO v_profile_tier
  FROM public.au_user_profiles
  WHERE user_id = p_user_id;

  IF v_profile_tier = 'admin' THEN
    v_profile_plan := 'pro';
  ELSIF v_profile_tier = 'premium' THEN
    v_profile_plan := 'premium';
  ELSIF v_profile_tier IN ('pro', 'weekly', 'monthly', 'paid') THEN
    v_profile_plan := 'pro';
  ELSIF v_profile_tier = 'free' THEN
    v_profile_plan := 'free';
  END IF;

  BEGIN
    SELECT LOWER(COALESCE(plan, '')), LOWER(COALESCE(source, 'none')), expires_at
    INTO v_mirrored_plan, v_mirrored_source, v_mirrored_expires_at
    FROM public.au_user_entitlements
    WHERE user_id = p_user_id
    LIMIT 1;
  EXCEPTION
    WHEN undefined_table THEN
      v_mirrored_plan := NULL;
      v_mirrored_source := 'none';
      v_mirrored_expires_at := NULL;
  END;

  IF v_mirrored_plan IN ('pro', 'weekly', 'monthly', 'paid', 'admin') THEN
    v_mirrored_plan := 'pro';
  ELSIF v_mirrored_plan = 'promo_pro' THEN
    v_mirrored_plan := NULL;
  ELSIF v_mirrored_plan NOT IN ('free', 'pro', 'premium') THEN
    v_mirrored_plan := NULL;
  END IF;

  IF v_mirrored_source NOT IN ('paid', 'promo', 'none') THEN
    v_mirrored_source := 'none';
  END IF;

  BEGIN
    v_entitlements := public.get_effective_entitlements(p_user_id);
  EXCEPTION
    WHEN undefined_function THEN
      v_entitlements := '{}'::jsonb;
  END;

  v_has_pro := COALESCE((v_entitlements->>'has_pro')::BOOLEAN, FALSE);
  v_entitlement_plan := LOWER(COALESCE(v_entitlements->>'plan', ''));
  v_has_paid_billing_plan := (
    v_entitlement_plan IN ('pro', 'weekly', 'monthly', 'paid')
    AND LOWER(COALESCE(v_entitlements->>'entitlement_source', '')) = 'paid'
  );
  v_has_promo_access := (
    LOWER(COALESCE(v_entitlements->>'entitlement_source', '')) = 'promo'
    OR v_entitlement_plan = 'promo_pro'
    OR v_profile_tier = 'promo_pro'
  );

  IF v_profile_tier = 'admin' THEN
    v_effective_plan := 'pro';
    v_plan_source := 'profile';
    v_entitlement_source := 'paid';
    v_expires_at := NULL;
  ELSIF v_profile_plan = 'premium' THEN
    v_effective_plan := 'premium';
    v_plan_source := 'profile';
    v_entitlement_source := 'paid';
    v_expires_at := NULL;
  ELSIF v_mirrored_plan = 'premium' THEN
    v_effective_plan := 'premium';
    v_plan_source := 'au_user_entitlements';
    v_entitlement_source := CASE WHEN v_mirrored_source = 'none' THEN 'paid' ELSE v_mirrored_source END;
    v_expires_at := v_mirrored_expires_at;
  ELSIF v_has_paid_billing_plan THEN
    v_effective_plan := 'pro';
    v_plan_source := 'billing';
    v_entitlement_source := 'paid';
    v_expires_at := NULLIF(v_entitlements->>'entitlement_ends_at', '')::timestamptz;
  ELSIF v_mirrored_plan IS NOT NULL THEN
    v_effective_plan := v_mirrored_plan;
    v_plan_source := 'au_user_entitlements';
    v_entitlement_source := CASE
      WHEN v_mirrored_plan = 'free' THEN 'none'
      WHEN v_mirrored_source = 'none' THEN 'paid'
      ELSE v_mirrored_source
    END;
    v_expires_at := v_mirrored_expires_at;
  ELSIF v_profile_plan IS NOT NULL THEN
    v_effective_plan := v_profile_plan;
    v_plan_source := 'profile';
    v_entitlement_source := CASE WHEN v_profile_plan = 'free' THEN 'none' ELSE 'paid' END;
    v_expires_at := NULL;
  ELSIF v_has_promo_access THEN
    v_effective_plan := 'free';
    v_plan_source := 'billing';
    v_entitlement_source := 'promo';
    v_expires_at := NULLIF(v_entitlements->>'entitlement_ends_at', '')::timestamptz;
  END IF;

  v_seed_limits := CASE v_effective_plan
    WHEN 'premium' THEN jsonb_build_object(
      'max_chats_total', 100000,
      'max_uploads_total', 1500,
      'max_tokens_total', 45000,
      'max_file_size_mb', 50,
      'max_concurrent_jobs', 6,
      'max_exam_predictions', 1000,
      'max_practice_exams', 1000,
      'max_knowledge_hub', 1500
    )
    WHEN 'pro' THEN jsonb_build_object(
      'max_chats_total', 30000,
      'max_uploads_total', 500,
      'max_tokens_total', 18000,
      'max_file_size_mb', 50,
      'max_concurrent_jobs', 3,
      'max_exam_predictions', 200,
      'max_practice_exams', 200,
      'max_knowledge_hub', 500
    )
    ELSE jsonb_build_object(
      'max_chats_total', 3000,
      'max_uploads_total', 50,
      'max_tokens_total', 4000,
      'max_file_size_mb', 50,
      'max_concurrent_jobs', 1,
      'max_exam_predictions', 10,
      'max_practice_exams', 10,
      'max_knowledge_hub', 50
    )
  END;

  BEGIN
    SELECT limits
    INTO v_legacy_limits
    FROM public.plan_limits
    WHERE plan = v_effective_plan
      AND effective_from <= v_now
    ORDER BY effective_from DESC
    LIMIT 1;
  EXCEPTION
    WHEN undefined_table THEN
      v_legacy_limits := '{}'::jsonb;
  END;
  v_legacy_limits := COALESCE(v_legacy_limits, '{}'::jsonb);

  BEGIN
    EXECUTE 'SELECT COALESCE(limits_override, ''{}''::jsonb) FROM public.au_user_profiles WHERE user_id = $1'
    INTO v_profile_overrides
    USING p_user_id;
  EXCEPTION
    WHEN undefined_column THEN
      v_profile_overrides := '{}'::jsonb;
  END;

  IF jsonb_typeof(v_profile_overrides) = 'object' THEN
    v_legacy_limits := v_legacy_limits || v_profile_overrides;
  END IF;

  v_fallback_canonical := jsonb_build_object(
    'max_chats_total', COALESCE((v_legacy_limits->>'max_chats_total')::BIGINT, (v_legacy_limits->>'max_messages_per_day')::BIGINT, (v_seed_limits->>'max_chats_total')::BIGINT),
    'max_uploads_total', COALESCE((v_legacy_limits->>'max_uploads_total')::BIGINT, (v_seed_limits->>'max_uploads_total')::BIGINT),
    'max_tokens_total', COALESCE((v_legacy_limits->>'max_tokens_total')::BIGINT, (v_legacy_limits->>'max_tokens_per_day')::BIGINT, (v_seed_limits->>'max_tokens_total')::BIGINT),
    'max_file_size_mb', COALESCE((v_legacy_limits->>'max_file_size_mb')::BIGINT, (v_legacy_limits->>'max_file_mb')::BIGINT, (v_seed_limits->>'max_file_size_mb')::BIGINT),
    'max_concurrent_jobs', COALESCE((v_legacy_limits->>'max_concurrent_jobs')::BIGINT, (v_legacy_limits->>'max_jobs_concurrent')::BIGINT, (v_seed_limits->>'max_concurrent_jobs')::BIGINT),
    'max_exam_predictions', COALESCE((v_legacy_limits->>'max_exam_predictions')::BIGINT, (v_legacy_limits->>'max_exams_total')::BIGINT, (v_seed_limits->>'max_exam_predictions')::BIGINT),
    'max_practice_exams', COALESCE((v_legacy_limits->>'max_practice_exams')::BIGINT, (v_legacy_limits->>'max_exams_total')::BIGINT, (v_seed_limits->>'max_practice_exams')::BIGINT),
    'max_knowledge_hub', COALESCE((v_legacy_limits->>'max_knowledge_hub')::BIGINT, (v_legacy_limits->>'max_documents_total')::BIGINT, (v_legacy_limits->>'max_docs_total')::BIGINT, (v_seed_limits->>'max_knowledge_hub')::BIGINT)
  );

  BEGIN
    WITH effective_rules AS (
      SELECT
        merged.limit_key,
        merged.value,
        merged.is_enabled,
        merged.is_unlimited
      FROM (
        SELECT
          COALESCE(plan_rules.limit_key, default_rules.limit_key) AS limit_key,
          COALESCE(plan_rules.value, default_rules.value) AS value,
          COALESCE(plan_rules.is_enabled, default_rules.is_enabled, TRUE) AS is_enabled,
          COALESCE(plan_rules.is_unlimited, default_rules.is_unlimited, FALSE) AS is_unlimited
        FROM
          (SELECT * FROM public.au_plan_limit_rules WHERE scope = 'default') AS default_rules
        FULL OUTER JOIN
          (SELECT * FROM public.au_plan_limit_rules WHERE scope = v_effective_plan) AS plan_rules
        ON plan_rules.limit_key = default_rules.limit_key
      ) AS merged
      WHERE merged.limit_key IN (
        'max_chats_total',
        'max_uploads_total',
        'max_tokens_total',
        'max_file_size_mb',
        'max_concurrent_jobs',
        'max_exam_predictions',
        'max_practice_exams',
        'max_knowledge_hub'
      )
    )
    SELECT COALESCE(
      jsonb_object_agg(
        limit_key,
        CASE
          WHEN COALESCE(is_unlimited, FALSE) THEN 'null'::jsonb
          WHEN COALESCE(is_enabled, TRUE) IS DISTINCT FROM TRUE THEN to_jsonb(0)
          WHEN value IS NULL THEN to_jsonb(0)
          ELSE to_jsonb(GREATEST(0, value))
        END
      ),
      '{}'::jsonb
    )
    INTO v_canonical_limits
    FROM effective_rules;
  EXCEPTION
    WHEN undefined_table THEN
      v_canonical_limits := '{}'::jsonb;
  END;

  v_canonical_limits := v_seed_limits || v_fallback_canonical || COALESCE(v_canonical_limits, '{}'::jsonb);
  v_limits := COALESCE(v_legacy_limits, '{}'::jsonb) || COALESCE(v_canonical_limits, '{}'::jsonb);

  IF v_limits ? 'max_file_size_mb' THEN
    v_limits := jsonb_set(
      v_limits,
      '{max_file_mb}',
      COALESCE(v_limits->'max_file_mb', v_limits->'max_file_size_mb', 'null'::jsonb),
      TRUE
    );
  END IF;

  IF v_limits ? 'max_concurrent_jobs' THEN
    v_limits := jsonb_set(
      v_limits,
      '{max_jobs_concurrent}',
      COALESCE(v_limits->'max_jobs_concurrent', v_limits->'max_concurrent_jobs', 'null'::jsonb),
      TRUE
    );
  END IF;

  IF NOT (v_limits ? 'max_exams_total') THEN
    IF (v_limits->>'max_exam_predictions') IS NULL OR (v_limits->>'max_practice_exams') IS NULL THEN
      v_limits := jsonb_set(v_limits, '{max_exams_total}', 'null'::jsonb, TRUE);
    ELSE
      v_limits := jsonb_set(
        v_limits,
        '{max_exams_total}',
        to_jsonb(
          GREATEST(
            COALESCE((v_limits->>'max_exam_predictions')::BIGINT, 0),
            COALESCE((v_limits->>'max_practice_exams')::BIGINT, 0)
          )
        ),
        TRUE
      );
    END IF;
  END IF;

  BEGIN
    SELECT retention_days
    INTO v_retention_days
    FROM public.au_plan_metadata
    WHERE plan = v_effective_plan
    LIMIT 1;
  EXCEPTION
    WHEN undefined_table THEN
      v_retention_days := NULL;
  END;

  IF v_retention_days IS NULL OR v_retention_days < 1 THEN
    v_retention_days := CASE
      WHEN v_entitlement_source = 'promo' THEN 14
      WHEN v_effective_plan IN ('pro', 'premium') THEN 30
      ELSE 14
    END;
  END IF;

  v_usage := public.get_usage_snapshot(p_user_id);

  RETURN jsonb_build_object(
    'user_id', p_user_id,
    'plan', v_effective_plan,
    'source', v_plan_source,
    'entitlement_source', v_entitlement_source,
    'entitlement_ends_at', v_expires_at,
    'retention_days', v_retention_days,
    'limits', v_limits,
    'usage', COALESCE(v_usage, '{}'::jsonb),
    'reset_at', COALESCE(v_usage->>'reset_at', to_char(date_trunc('day', v_now) + interval '1 day', 'YYYY-MM-DD"T"HH24:MI:SSOF')),
    'as_of', v_now
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_effective_limits(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_effective_limits(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_effective_limits(UUID) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
