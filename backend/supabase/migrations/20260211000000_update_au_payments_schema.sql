-- Update au_payments to match strict billing requirements
-- Timestamp: 20260211000000

-- 1. Standardize au_payments columns
DO $$ 
BEGIN
    -- Rename user_id to owner_id
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'au_payments' AND column_name = 'user_id') THEN
        ALTER TABLE au_payments RENAME COLUMN user_id TO owner_id;
    END IF;

    -- Rename provider_ref to reference
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'au_payments' AND column_name = 'provider_ref') THEN
        ALTER TABLE au_payments RENAME COLUMN provider_ref TO reference;
    END IF;
END $$;

ALTER TABLE public.au_payments 
    ADD COLUMN IF NOT EXISTS channel TEXT,
    ADD COLUMN IF NOT EXISTS paystack_tx_id TEXT,
    ADD COLUMN IF NOT EXISTS last_webhook_event_id TEXT UNIQUE,
    ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS amount_ngn NUMERIC;

-- Populate amount_ngn from amount if empty
UPDATE public.au_payments SET amount_ngn = amount WHERE amount_ngn IS NULL;

-- Ensure reference is unique
ALTER TABLE public.au_payments DROP CONSTRAINT IF EXISTS au_payments_reference_key;
ALTER TABLE public.au_payments ADD CONSTRAINT au_payments_reference_key UNIQUE (reference);

-- 2. Create Admin Approval Queue View (Optional but helpful)
CREATE OR REPLACE VIEW public.au_admin_manual_review_queue AS
SELECT 
    id,
    owner_id,
    reference,
    plan,
    amount_ngn,
    channel,
    status,
    created_at
FROM public.au_payments
WHERE status = 'manual_review' OR (status = 'pending' AND created_at < NOW() - INTERVAL '30 minutes');

-- 3. Function to Approve Manual Payment (Admin Only)
CREATE OR REPLACE FUNCTION public.approve_manual_payment(
    p_payment_id UUID,
    p_admin_id UUID,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_payment public.au_payments%ROWTYPE;
    v_user_id UUID;
    v_plan TEXT;
    v_expiry TIMESTAMPTZ;
BEGIN
    -- Check Admin Permissions (implementation depends on how admins are stored)
    -- Assuming a check here or RLS on the function execution
    -- For now, we trust the caller has permission (handled by API/RLS)

    SELECT * INTO v_payment FROM public.au_payments WHERE id = p_payment_id;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Payment not found');
    END IF;

    IF v_payment.status = 'success' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Already processed');
    END IF;

    -- Update Payment
    UPDATE public.au_payments
    SET 
        status = 'success',
        confirmed_at = NOW(),
        updated_at = NOW()
    WHERE id = p_payment_id;

    -- Update User Profile (Tier Upgrade)
    v_user_id := v_payment.owner_id;
    v_plan := v_payment.plan;
    
    -- Calculate new expiry
    SELECT tier_expires_at INTO v_expiry FROM public.au_user_profiles WHERE user_id = v_user_id;
    
    IF v_expiry IS NULL OR v_expiry < NOW() THEN
        v_expiry := NOW();
    END IF;

    IF v_plan = 'weekly' THEN
        v_expiry := v_expiry + INTERVAL '7 days';
    ELSIF v_plan = 'monthly' THEN
        v_expiry := v_expiry + INTERVAL '30 days';
    END IF;

    UPDATE public.au_user_profiles
    SET 
        tier = 'pro',
        tier_expires_at = v_expiry,
        billing_source = 'manual_admin',
        updated_at = NOW()
    WHERE user_id = v_user_id;

    -- Log Audit (if audit table exists)
    -- INSERT INTO au_audit_logs ...

    RETURN jsonb_build_object('success', true, 'new_expiry', v_expiry);
END;
$$;
