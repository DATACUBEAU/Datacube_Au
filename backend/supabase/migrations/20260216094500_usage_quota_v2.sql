DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'au_config'
  ) THEN
    ALTER TABLE public.au_config
      ADD COLUMN IF NOT EXISTS free_au_chat_daily_limit INT DEFAULT 15,
      ADD COLUMN IF NOT EXISTS free_practice_exams_daily_limit INT DEFAULT 1,
      ADD COLUMN IF NOT EXISTS free_predictions_daily_limit INT DEFAULT 3,
      ADD COLUMN IF NOT EXISTS free_knowledge_generate_daily_limit INT DEFAULT 1,
      ADD COLUMN IF NOT EXISTS free_max_docs INT DEFAULT 3,
      ADD COLUMN IF NOT EXISTS free_knowledge_max_mb INT DEFAULT 3,
      ADD COLUMN IF NOT EXISTS free_knowledge_max_pages INT DEFAULT 15;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'au_usage_daily'
  ) THEN
    ALTER TABLE public.au_usage_daily RENAME TO au_usage_daily_legacy;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.au_usage_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  feature TEXT NOT NULL,
  count INT NOT NULL DEFAULT 0,
  mb NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(owner_id, day, feature)
);

ALTER TABLE public.au_usage_daily ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'au_usage_daily' AND policyname = 'Users can read own usage v2'
  ) THEN
    CREATE POLICY "Users can read own usage v2"
      ON public.au_usage_daily
      FOR SELECT
      USING (auth.uid() = owner_id);
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.consume_au_usage_daily(UUID, TEXT, INT, NUMERIC);

CREATE OR REPLACE FUNCTION public.consume_au_usage_daily(
  p_owner_id UUID,
  p_feature TEXT,
  p_count_inc INT DEFAULT 1,
  p_mb_inc NUMERIC DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  cfg RECORD;
  day_utc DATE;
  u RECORD;
  limit_count INT;
  used_count INT;
  resets_at TIMESTAMPTZ;
  is_pro BOOLEAN;
BEGIN
  SELECT * INTO cfg FROM public.au_config LIMIT 1;

  IF cfg IS NULL OR cfg.billing_enabled IS DISTINCT FROM TRUE THEN
    RETURN jsonb_build_object('allowed', true, 'billing_enabled', false);
  END IF;

  SELECT (
    tier = 'pro'
    AND (
      tier_expires_at IS NULL
      OR tier_expires_at > NOW()
    )
  ) INTO is_pro
  FROM public.au_user_profiles
  WHERE user_id = p_owner_id;

  IF COALESCE(is_pro, false) THEN
    RETURN jsonb_build_object('allowed', true, 'billing_enabled', true, 'is_pro', true);
  END IF;

  day_utc := (timezone('utc', NOW()))::date;
  resets_at := ((day_utc + 1)::timestamptz AT TIME ZONE 'utc');

  limit_count := NULL;
  IF p_feature = 'au_chat' THEN
    limit_count := COALESCE(cfg.free_au_chat_daily_limit, 15);
  ELSIF p_feature = 'practice_exams' THEN
    limit_count := COALESCE(cfg.free_practice_exams_daily_limit, 1);
  ELSIF p_feature = 'predictions' THEN
    limit_count := COALESCE(cfg.free_predictions_daily_limit, 3);
  ELSIF p_feature = 'knowledge_generate' THEN
    limit_count := COALESCE(cfg.free_knowledge_generate_daily_limit, 1);
  END IF;

  IF limit_count IS NULL THEN
    RETURN jsonb_build_object('allowed', true, 'billing_enabled', true);
  END IF;

  INSERT INTO public.au_usage_daily (owner_id, day, feature)
  VALUES (p_owner_id, day_utc, p_feature)
  ON CONFLICT (owner_id, day, feature) DO NOTHING;

  SELECT * INTO u
  FROM public.au_usage_daily
  WHERE owner_id = p_owner_id AND day = day_utc AND feature = p_feature
  FOR UPDATE;

  used_count := COALESCE(u.count, 0);

  IF used_count + COALESCE(p_count_inc, 0) > limit_count THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'code', 'LIMIT_REACHED',
      'feature', p_feature,
      'limit', limit_count,
      'used', used_count,
      'reset_at', resets_at::text,
      'resetsAt', resets_at::text
    );
  END IF;

  UPDATE public.au_usage_daily
  SET
    count = count + COALESCE(p_count_inc, 0),
    mb = mb + COALESCE(p_mb_inc, 0),
    updated_at = NOW()
  WHERE owner_id = p_owner_id AND day = day_utc AND feature = p_feature;

  RETURN jsonb_build_object(
    'allowed', true,
    'billing_enabled', true,
    'feature', p_feature,
    'limit', limit_count,
    'used', used_count + COALESCE(p_count_inc, 0),
    'reset_at', resets_at::text,
    'resetsAt', resets_at::text
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.consume_au_usage_daily(UUID, TEXT, INT, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_au_usage_daily(UUID, TEXT, INT, NUMERIC) TO service_role;

