-- Consolidated Billing & Strict Mode Migration
-- Timestamp: 20260207090001

-- 1. Manual Payments Table
-- Handle cases where table exists (from 010000) or needs creation
CREATE TABLE IF NOT EXISTS public.au_manual_payments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    amount NUMERIC NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add columns if they are missing (idempotent)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'au_manual_payments' AND column_name = 'plan') THEN
        ALTER TABLE public.au_manual_payments ADD COLUMN plan TEXT CHECK (plan IN ('weekly', 'monthly'));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'au_manual_payments' AND column_name = 'reference') THEN
        ALTER TABLE public.au_manual_payments ADD COLUMN reference TEXT;
    END IF;
    
    -- Ensure reference_code exists if we want to align with 010000, but our code uses 'reference'
    -- We'll just ensure our code's 'reference' column is there.
END $$;

-- Enable RLS for manual payments if not already enabled
ALTER TABLE public.au_manual_payments ENABLE ROW LEVEL SECURITY;

-- Policies (Drop and Recreate to ensure correctness)
DROP POLICY IF EXISTS "Users can view own manual payments" ON public.au_manual_payments;
CREATE POLICY "Users can view own manual payments" ON public.au_manual_payments
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create manual payments" ON public.au_manual_payments;
CREATE POLICY "Users can create manual payments" ON public.au_manual_payments
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 2. Weekly Feature Usage Table
CREATE TABLE IF NOT EXISTS public.au_weekly_feature_usage (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    week_start_date DATE NOT NULL,
    active_doc_id UUID, -- Can be null initially, set on first use
    summary_used BOOLEAN DEFAULT FALSE,
    prediction_used BOOLEAN DEFAULT FALSE,
    cbt_used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(owner_id, week_start_date)
);

-- Enable RLS
ALTER TABLE public.au_weekly_feature_usage ENABLE ROW LEVEL SECURITY;

-- 3. Update Conex Config
-- Add billing/strict mode flags
ALTER TABLE public.au_conex_config 
ADD COLUMN IF NOT EXISTS free_pressure_mode_enabled BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS bank_account_name TEXT DEFAULT '',
ADD COLUMN IF NOT EXISTS bank_name TEXT DEFAULT '',
ADD COLUMN IF NOT EXISTS bank_account_number TEXT DEFAULT '',
ADD COLUMN IF NOT EXISTS bank_instructions TEXT DEFAULT '',
ADD COLUMN IF NOT EXISTS stripe_price_weekly TEXT DEFAULT '',
ADD COLUMN IF NOT EXISTS stripe_price_monthly TEXT DEFAULT '';

-- Add flags from conex_flags.sql
ALTER TABLE public.au_conex_config
ADD COLUMN IF NOT EXISTS premium_models_paid_only BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS premium_models_allowlist TEXT[] DEFAULT '{}';

-- 4. Update User Profiles
ALTER TABLE public.au_user_profiles
ADD COLUMN IF NOT EXISTS tier_expires_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS billing_source TEXT DEFAULT 'stripe'; -- 'stripe' or 'manual'

-- 5. RPC to atomic update weekly usage (prevent race conditions)
CREATE OR REPLACE FUNCTION public.check_and_update_weekly_quota(
    p_user_id UUID,
    p_week_start DATE,
    p_doc_id UUID,
    p_feature_type TEXT -- 'summary', 'prediction', 'cbt'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_usage_record public.au_weekly_feature_usage%ROWTYPE;
    v_result JSONB;
BEGIN
    -- Lock the row if it exists, or ensure we're the only one inserting
    INSERT INTO public.au_weekly_feature_usage (owner_id, week_start_date)
    VALUES (p_user_id, p_week_start)
    ON CONFLICT (owner_id, week_start_date) DO NOTHING;

    -- Now select for update to lock the row
    SELECT * INTO v_usage_record
    FROM public.au_weekly_feature_usage
    WHERE owner_id = p_user_id AND week_start_date = p_week_start
    FOR UPDATE;

    -- Check Active Doc Rule
    IF v_usage_record.active_doc_id IS NOT NULL AND v_usage_record.active_doc_id != p_doc_id THEN
        RETURN jsonb_build_object('allowed', false, 'reason', 'ACTIVE_DOC_MISMATCH');
    END IF;

    -- Check Feature Usage
    IF p_feature_type = 'summary' AND v_usage_record.summary_used THEN
        RETURN jsonb_build_object('allowed', false, 'reason', 'ALREADY_USED');
    ELSIF p_feature_type = 'prediction' AND v_usage_record.prediction_used THEN
        RETURN jsonb_build_object('allowed', false, 'reason', 'ALREADY_USED');
    ELSIF p_feature_type = 'cbt' AND v_usage_record.cbt_used THEN
        RETURN jsonb_build_object('allowed', false, 'reason', 'ALREADY_USED');
    END IF;

    -- If we get here, it's allowed. Update the record.
    UPDATE public.au_weekly_feature_usage
    SET 
        active_doc_id = COALESCE(active_doc_id, p_doc_id), -- Set if null
        summary_used = CASE WHEN p_feature_type = 'summary' THEN TRUE ELSE summary_used END,
        prediction_used = CASE WHEN p_feature_type = 'prediction' THEN TRUE ELSE prediction_used END,
        cbt_used = CASE WHEN p_feature_type = 'cbt' THEN TRUE ELSE cbt_used END,
        updated_at = NOW()
    WHERE id = v_usage_record.id;

    RETURN jsonb_build_object('allowed', true);
END;
$$;
