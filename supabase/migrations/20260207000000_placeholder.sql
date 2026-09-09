-- Migration: Billing, Conex Config, and Events
-- 20260207000000_billing_and_conex.sql

-- 1. Update au_user_profiles with billing fields
ALTER TABLE au_user_profiles 
ADD COLUMN IF NOT EXISTS tier TEXT DEFAULT 'free',
ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS stripe_price_id TEXT,
ADD COLUMN IF NOT EXISTS stripe_current_period_end TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS stripe_status TEXT;

-- 2. Create au_conex_config
CREATE TABLE IF NOT EXISTS au_conex_config (
    id INTEGER PRIMARY KEY DEFAULT 1,
    billing_enabled BOOLEAN DEFAULT false,
    premium_models_enabled BOOLEAN DEFAULT false,
    premium_limits_enabled BOOLEAN DEFAULT false,
    premium_upload_limits_enabled BOOLEAN DEFAULT false,
    stripe_live_mode BOOLEAN DEFAULT false,
    allowed_price_ids TEXT[] DEFAULT '{}',
    updated_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT single_row CHECK (id = 1)
);

-- Insert default row if not exists
INSERT INTO au_conex_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- RLS for au_conex_config
ALTER TABLE au_conex_config ENABLE ROW LEVEL SECURITY;

-- Admins can update
CREATE POLICY "Admins can update conex config" ON au_conex_config
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM au_user_profiles
            WHERE user_id = (SELECT au_users.id FROM au_users JOIN auth.users ON au_users.id = auth.users.id WHERE auth.uid() = au_users.id) 
            AND role = 'admin'
        )
    );

-- Everyone (authenticated) can read (for UI/Edge Functions)
CREATE POLICY "Authenticated users can read conex config" ON au_conex_config
    FOR SELECT
    USING (auth.role() = 'authenticated');

-- Service role can do anything
CREATE POLICY "Service role full access conex config" ON au_conex_config
    FOR ALL
    USING (true)
    WITH CHECK (true);


-- 3. Create au_stripe_events for idempotency
CREATE TABLE IF NOT EXISTS au_stripe_events (
    id TEXT PRIMARY KEY, -- stripe event id
    type TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE au_stripe_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role only stripe events" ON au_stripe_events
    FOR ALL
    USING (true)
    WITH CHECK (true);


-- 4. Update/Create au_events for analytics
CREATE TABLE IF NOT EXISTS au_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES au_users(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Ensure columns exist (handling if table already existed)
ALTER TABLE au_events ADD COLUMN IF NOT EXISTS tier TEXT;
ALTER TABLE au_events ADD COLUMN IF NOT EXISTS session_id UUID;
ALTER TABLE au_events ADD COLUMN IF NOT EXISTS params JSONB DEFAULT '{}'::jsonb; 
-- Note: existing code uses 'metadata', new requirement might imply 'params'. We'll support both or map them.

ALTER TABLE au_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage events" ON au_events
    FOR ALL
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Users can view their own events" ON au_events
    FOR SELECT
    USING (user_id = (SELECT id FROM au_users WHERE id = auth.uid()));

-- 5. Notify schema reload
NOTIFY pgrst, 'reload schema';
