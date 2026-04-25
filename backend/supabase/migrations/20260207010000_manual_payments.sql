-- Migration: Manual Payments and Invoices
-- 20260207010000_manual_payments.sql

-- 1. Create au_manual_payments table
CREATE TABLE IF NOT EXISTS au_manual_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES au_users(id) ON DELETE CASCADE,
    amount NUMERIC NOT NULL,
    currency TEXT DEFAULT 'NGN',
    reference_code TEXT UNIQUE NOT NULL,
    status TEXT DEFAULT 'pending', -- pending, confirmed, rejected
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- RLS for manual payments
ALTER TABLE au_manual_payments ENABLE ROW LEVEL SECURITY;

-- Users can view their own payments
CREATE POLICY "Users can view own manual payments" ON au_manual_payments
    FOR SELECT
    USING (user_id = (SELECT id FROM au_users WHERE id = auth.uid()));

-- Users can insert (submit) payments
CREATE POLICY "Users can submit manual payments" ON au_manual_payments
    FOR INSERT
    WITH CHECK (user_id = (SELECT id FROM au_users WHERE id = auth.uid()));

-- Service role / Admins can do everything
CREATE POLICY "Service role full access manual payments" ON au_manual_payments
    FOR ALL
    USING (true)
    WITH CHECK (true);


-- 2. Add Invoice Metadata to au_user_profiles
ALTER TABLE au_user_profiles 
ADD COLUMN IF NOT EXISTS latest_invoice_url TEXT,
ADD COLUMN IF NOT EXISTS last_payment_date TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_payment_amount NUMERIC;

-- 3. Notify schema reload
NOTIFY pgrst, 'reload schema';
