-- 20260207000002_billing_overhaul.sql
-- Unified Billing System (Stripe + Paystack + Manual)

-- 1. Update au_user_profiles
ALTER TABLE au_user_profiles
ADD COLUMN IF NOT EXISTS tier_expires_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS billing_source TEXT DEFAULT 'stripe', -- stripe, paystack, manual
ADD COLUMN IF NOT EXISTS paystack_customer_code TEXT,
ADD COLUMN IF NOT EXISTS paystack_subscription_code TEXT,
ADD COLUMN IF NOT EXISTS paystack_auth_code TEXT; -- For recurring charges if needed

-- 2. Refactor au_stripe_events -> au_billing_events
-- If au_stripe_events exists, rename it. If not, create au_billing_events.
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'au_stripe_events') THEN
        ALTER TABLE au_stripe_events RENAME TO au_billing_events;
        ALTER TABLE au_billing_events RENAME COLUMN id TO event_id;
        ALTER TABLE au_billing_events ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT 'stripe';
        -- Drop old PK
        ALTER TABLE au_billing_events DROP CONSTRAINT IF EXISTS au_stripe_events_pkey;
    ELSE
        CREATE TABLE IF NOT EXISTS au_billing_events (
            event_id TEXT NOT NULL,
            type TEXT NOT NULL,
            created_at TIMESTAMPTZ DEFAULT now(),
            provider TEXT DEFAULT 'stripe'
        );
    END IF;
END $$;

-- Add new composite PK
ALTER TABLE au_billing_events ADD CONSTRAINT au_billing_events_pkey PRIMARY KEY (provider, event_id);

-- RLS for au_billing_events (Service Role Only)
ALTER TABLE au_billing_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role only billing events" ON au_billing_events;
CREATE POLICY "Service role only billing events" ON au_billing_events FOR ALL USING (true) WITH CHECK (true);


-- 3. Create Unified Ledger: au_payments
CREATE TABLE IF NOT EXISTS au_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES au_users(id) ON DELETE SET NULL,
    provider TEXT NOT NULL, -- stripe, paystack, manual
    plan TEXT NOT NULL, -- weekly, monthly
    amount NUMERIC NOT NULL,
    currency TEXT DEFAULT 'NGN',
    status TEXT NOT NULL, -- pending, succeeded, failed, refunded, cancelled
    provider_ref TEXT, -- stripe invoice id, paystack reference
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- RLS for au_payments
ALTER TABLE au_payments ENABLE ROW LEVEL SECURITY;

-- Users can read their own payments
CREATE POLICY "Users can view own payments" ON au_payments
    FOR SELECT USING (user_id = (SELECT id FROM au_users WHERE id = auth.uid()));

-- Service Role has full access
CREATE POLICY "Service role full access payments" ON au_payments
    FOR ALL USING (true) WITH CHECK (true);


-- 4. Update Conex Config
ALTER TABLE au_conex_config
ADD COLUMN IF NOT EXISTS stripe_price_weekly_id TEXT,
ADD COLUMN IF NOT EXISTS stripe_price_monthly_id TEXT,
ADD COLUMN IF NOT EXISTS paystack_amount_weekly NUMERIC DEFAULT 1900,
ADD COLUMN IF NOT EXISTS paystack_amount_monthly NUMERIC DEFAULT 4500,
ADD COLUMN IF NOT EXISTS bank_transfer_details JSONB DEFAULT '{"bank_name": "Moniepoint", "account_number": "1234567890", "account_name": "Datacube AU"}'::jsonb,
ADD COLUMN IF NOT EXISTS free_pressure_mode_enabled BOOLEAN DEFAULT false;


-- 5. Helper Function to migrate old manual payments (optional, best effort)
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'au_manual_payments') THEN
        INSERT INTO au_payments (user_id, provider, plan, amount, status, provider_ref, created_at)
        SELECT user_id, 'manual', 'unknown', amount, status, reference_code, created_at
        FROM au_manual_payments
        ON CONFLICT DO NOTHING;
    END IF;
END $$;

NOTIFY pgrst, 'reload schema';
