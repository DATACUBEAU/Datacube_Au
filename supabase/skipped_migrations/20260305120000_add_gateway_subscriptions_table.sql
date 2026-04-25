CREATE TABLE IF NOT EXISTS public.subscriptions (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'active',
  plan text NOT NULL,
  gateway text NOT NULL CHECK (gateway IN ('paystack', 'flutterwave')),
  transaction_id text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON public.subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_gateway ON public.subscriptions(gateway);
