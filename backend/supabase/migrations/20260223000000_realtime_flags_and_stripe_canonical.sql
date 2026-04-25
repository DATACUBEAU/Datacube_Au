-- Ensure config tables broadcast over Supabase Realtime
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'au_conex_config'
    ) THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.au_conex_config';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'au_feature_flags'
    ) THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.au_feature_flags';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'au_config'
    ) THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.au_config';
    END IF;
  END IF;
END $$;

-- Seed required feature flags (idempotent)
WITH cfg AS (
  SELECT * FROM public.au_conex_config WHERE id = 1
)
INSERT INTO public.au_feature_flags (key, is_enabled, description, updated_at)
VALUES
  (
    'global_chat_enabled',
    COALESCE((SELECT global_chat_enabled FROM cfg), true),
    'Enable Global Chat across the app.',
    now()
  ),
  (
    'premium_models_enabled',
    COALESCE((SELECT premium_models_enabled FROM cfg), true),
    'Master switch for premium model availability.',
    now()
  ),
  (
    'premium_models_paid_only',
    COALESCE((SELECT premium_models_paid_only FROM cfg), true),
    'When enabled, only paid users can access premium models.',
    now()
  ),
  (
    'billing_enabled',
    COALESCE((SELECT billing_enabled FROM cfg), false),
    'Master billing/monetization toggle.',
    now()
  ),
  (
    'stripe_live_mode',
    COALESCE((SELECT stripe_live_mode FROM cfg), false),
    'Use Stripe live mode pricing/behavior.',
    now()
  ),
  (
    'free_pressure_mode_enabled',
    COALESCE((SELECT free_pressure_mode_enabled FROM cfg), false),
    'Enable strict free-tier usage pressure mode.',
    now()
  ),
  (
    'paid_mode_enabled',
    COALESCE((SELECT paid_mode_enabled FROM cfg), false),
    'Force paid key path for model calls.',
    now()
  ),
  (
    'pro_upload_100mb',
    false,
    'Allow Pro users to upload up to 100MB.',
    now()
  )
ON CONFLICT (key) DO NOTHING;

-- Canonicalize Stripe price fields: prefer stripe_price_weekly/monthly moving forward
UPDATE public.au_conex_config
SET
  stripe_price_weekly = COALESCE(NULLIF(stripe_price_weekly, ''), NULLIF(stripe_price_weekly_id, '')),
  stripe_price_monthly = COALESCE(NULLIF(stripe_price_monthly, ''), NULLIF(stripe_price_monthly_id, '')),
  updated_at = now()
WHERE id = 1;

-- Keep legacy au_config.billing_enabled aligned (best-effort, idempotent)
UPDATE public.au_config
SET
  billing_enabled = (SELECT billing_enabled FROM public.au_conex_config WHERE id = 1),
  updated_at = now()
WHERE id IN (SELECT id FROM public.au_config LIMIT 1);
