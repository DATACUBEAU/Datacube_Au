-- Model routing flags + Paystack billing/entitlements foundation

-- 1) Feature flags for routing mode
INSERT INTO public.feature_flags (key, enabled, category, description, scope, config)
VALUES
  ('model_routing.tier_split_enabled', FALSE, 'billing', 'Legacy flag retained for compatibility; routing is paid-only.', 'global', '{}'::jsonb),
  ('model_routing.paid_default_enabled', TRUE, 'billing', 'Paid-only routing default (legacy compatibility flag).', 'global', '{}'::jsonb)
ON CONFLICT (key)
DO UPDATE
SET
  category = EXCLUDED.category,
  description = EXCLUDED.description,
  scope = EXCLUDED.scope;

-- 2) Reset unhealthy primary key state.
DO $$
BEGIN
  IF to_regclass('public.ai_provider_keys') IS NOT NULL THEN
    UPDATE public.ai_provider_keys
    SET error_count = 0
    WHERE service = 'openrouter_primary';

    -- Optional hard-disable of deprecated extra key:
    -- UPDATE public.ai_provider_keys SET is_active = FALSE WHERE service = 'openrouter_1';
  END IF;

  IF to_regclass('public.au_api_keys') IS NOT NULL THEN
    UPDATE public.au_api_keys
    SET error_count = 0
    WHERE service = 'openrouter_primary';

    -- Optional hard-disable of deprecated extra key:
    -- UPDATE public.au_api_keys SET is_active = FALSE WHERE service = 'openrouter_1';
  END IF;
END $$;

-- 3) Billing tables
CREATE TABLE IF NOT EXISTS public.billing_plans (
  id bigserial PRIMARY KEY,
  plan_key text NOT NULL UNIQUE,
  interval text NOT NULL CHECK (interval IN ('weekly', 'monthly')),
  amount_kobo integer NOT NULL CHECK (amount_kobo > 0),
  paystack_plan_code text NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.billing_customers (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE,
  email text NOT NULL,
  paystack_customer_code text NULL UNIQUE,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.billing_subscriptions (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL,
  plan_key text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  paystack_subscription_code text NULL,
  paystack_email_token text NULL,
  starts_at timestamptz NULL,
  ends_at timestamptz NULL,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

CREATE TABLE IF NOT EXISTS public.billing_transactions (
  id bigserial PRIMARY KEY,
  user_id uuid NULL,
  reference text NOT NULL UNIQUE,
  amount_kobo bigint NOT NULL DEFAULT 0,
  channel text NOT NULL DEFAULT 'unknown',
  status text NOT NULL DEFAULT 'pending',
  paid_at timestamptz NULL,
  raw_event_json jsonb NULL,
  idempotency_key text NULL UNIQUE,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.entitlement_grants (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL,
  entitlement text NOT NULL,
  source text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'active',
  reason text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.entitlement_audit (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL,
  action text NOT NULL,
  before_json jsonb NULL,
  after_json jsonb NULL,
  source text NOT NULL,
  trace_id text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Extra reliability tables
CREATE TABLE IF NOT EXISTS public.billing_webhook_events (
  id bigserial PRIMARY KEY,
  event_id text NULL,
  event_type text NOT NULL,
  reference text NULL,
  idempotency_key text NOT NULL UNIQUE,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'received',
  processed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ai_routing_audit (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL,
  plan text NOT NULL DEFAULT 'free',
  request_type text NOT NULL,
  tier_wanted text NOT NULL,
  service text NOT NULL,
  model text NOT NULL,
  tier_split_enabled boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_user_id ON public.billing_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_billing_transactions_user_id ON public.billing_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_billing_transactions_status ON public.billing_transactions(status);
CREATE INDEX IF NOT EXISTS idx_entitlement_grants_user_status ON public.entitlement_grants(user_id, status, entitlement);
CREATE INDEX IF NOT EXISTS idx_entitlement_grants_ends_at ON public.entitlement_grants(ends_at);
CREATE INDEX IF NOT EXISTS idx_webhook_events_reference ON public.billing_webhook_events(reference);
CREATE INDEX IF NOT EXISTS idx_ai_routing_audit_created_at ON public.ai_routing_audit(created_at DESC);
