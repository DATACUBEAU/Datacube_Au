-- Hybrid Billing Migration
-- Timestamp: 20260211100000

-- 1. Billing Plans Table
CREATE TABLE IF NOT EXISTS public.au_billing_plans (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    provider TEXT NOT NULL DEFAULT 'paystack',
    plan_code TEXT NOT NULL UNIQUE, -- Paystack Plan Code (PLN_xxx)
    interval TEXT NOT NULL CHECK (interval IN ('weekly', 'monthly')),
    amount_ngn NUMERIC NOT NULL,
    name TEXT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS for Billing Plans
ALTER TABLE public.au_billing_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read access for billing plans" ON public.au_billing_plans
    FOR SELECT USING (is_active = true);

-- 2. Subscriptions Table
CREATE TABLE IF NOT EXISTS public.au_subscriptions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL DEFAULT 'paystack',
    plan_interval TEXT NOT NULL CHECK (plan_interval IN ('weekly', 'monthly')),
    status TEXT NOT NULL CHECK (status IN ('active', 'non_renewing', 'canceled', 'past_due', 'completed')),
    paystack_subscription_code TEXT UNIQUE NOT NULL, -- SUB_xxx
    paystack_email_token TEXT NOT NULL, -- Required for cancellation
    paystack_customer_code TEXT, -- CUS_xxx
    current_period_start TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    canceled_at TIMESTAMPTZ,
    cancel_reason TEXT,
    cancel_source TEXT CHECK (cancel_source IN ('user', 'admin', 'system')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS for Subscriptions
ALTER TABLE public.au_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own subscriptions" ON public.au_subscriptions
    FOR SELECT USING (auth.uid() = owner_id);

-- 3. Ensure au_payments has all needed fields (Idempotent)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'au_payments' AND column_name = 'paystack_tx_id') THEN
        ALTER TABLE public.au_payments ADD COLUMN paystack_tx_id TEXT;
    END IF;
    
    -- Ensure status check includes manual_review
    -- (Constraints are hard to modify idempotently in simple SQL without dropping, so we assume valid values or add a check if critical)
END $$;

-- 4. Seed Initial Plans
INSERT INTO public.au_billing_plans (provider, plan_code, interval, amount_ngn, name)
VALUES 
    ('paystack', 'PLN_bc7vhwfff2mqc57', 'weekly', 1900, 'Pro Weekly'),
    ('paystack', 'PLN_axsdw7s4zniurzr', 'monthly', 4500, 'Pro Monthly')
ON CONFLICT (plan_code) DO NOTHING;

-- 5. RPC to Get Active Subscription (Helper)
CREATE OR REPLACE FUNCTION public.get_active_subscription(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_sub public.au_subscriptions%ROWTYPE;
BEGIN
    SELECT * INTO v_sub
    FROM public.au_subscriptions
    WHERE owner_id = p_user_id
    AND status IN ('active', 'non_renewing')
    ORDER BY created_at DESC
    LIMIT 1;
    
    IF v_sub.id IS NULL THEN
        RETURN NULL;
    END IF;
    
    RETURN to_jsonb(v_sub);
END;
$$;
