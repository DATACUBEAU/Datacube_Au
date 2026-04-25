-- 1) Single Source of Truth (au_config)
CREATE TABLE IF NOT EXISTS public.au_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    billing_enabled BOOLEAN DEFAULT false,
    free_chat_daily_limit INT DEFAULT 10,
    free_exam_daily_limit INT DEFAULT 2,
    free_upload_daily_limit INT DEFAULT 3,
    free_max_upload_mb INT DEFAULT 10,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Ensure only one row exists
CREATE UNIQUE INDEX IF NOT EXISTS au_config_one_row ON public.au_config((true));

-- Insert default row if not exists
INSERT INTO public.au_config (billing_enabled, free_chat_daily_limit, free_exam_daily_limit, free_upload_daily_limit, free_max_upload_mb)
VALUES (false, 10, 2, 3, 10)
ON CONFLICT DO NOTHING;

-- RLS for au_config
ALTER TABLE public.au_config ENABLE ROW LEVEL SECURITY;

-- Allow read for everyone
CREATE POLICY "Allow read for everyone" ON public.au_config
    FOR SELECT USING (true);

-- Allow update only for service_role (Admin)
CREATE POLICY "Service role can update config" ON public.au_config
    FOR UPDATE USING (auth.jwt() ->> 'role' = 'service_role');


-- 2) Usage Tracking (au_usage_daily)
CREATE TABLE IF NOT EXISTS public.au_usage_daily (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    day DATE NOT NULL DEFAULT CURRENT_DATE,
    chat_count INT DEFAULT 0,
    exam_count INT DEFAULT 0,
    upload_count INT DEFAULT 0,
    embed_mb NUMERIC DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(owner_id, day)
);

-- RLS for au_usage_daily
ALTER TABLE public.au_usage_daily ENABLE ROW LEVEL SECURITY;

-- Allow users to read their own usage
CREATE POLICY "Users can read own usage" ON public.au_usage_daily
    FOR SELECT USING (auth.uid() = owner_id);

-- Function to increment usage atomically
CREATE OR REPLACE FUNCTION public.consume_au_usage_daily(
    p_owner_id UUID,
    p_action TEXT,
    p_count_inc INT DEFAULT 1,
    p_mb_inc NUMERIC DEFAULT 0
)
RETURNS JSONB AS $$
DECLARE
    cfg RECORD;
    day_utc DATE;
    u RECORD;
    limit_count INT;
    limit_mb INT;
    used_count INT;
    used_mb NUMERIC;
    resets_at TIMESTAMPTZ;
    is_pro BOOLEAN;
BEGIN
    SELECT * INTO cfg FROM public.au_config LIMIT 1;

    IF cfg IS NULL OR cfg.billing_enabled IS DISTINCT FROM TRUE THEN
        RETURN jsonb_build_object('allowed', true, 'billingEnabled', false);
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
        RETURN jsonb_build_object('allowed', true, 'billingEnabled', true, 'isPro', true);
    END IF;

    day_utc := (timezone('utc', NOW()))::date;
    resets_at := ((day_utc + 1)::timestamptz AT TIME ZONE 'utc');

    INSERT INTO public.au_usage_daily (owner_id, day)
    VALUES (p_owner_id, day_utc)
    ON CONFLICT (owner_id, day) DO NOTHING;

    SELECT * INTO u
    FROM public.au_usage_daily
    WHERE owner_id = p_owner_id AND day = day_utc
    FOR UPDATE;

    IF p_action = 'chat' THEN
        limit_count := COALESCE(cfg.free_chat_daily_limit, 0);
        used_count := COALESCE(u.chat_count, 0);
        IF used_count + COALESCE(p_count_inc, 0) > limit_count THEN
            RETURN jsonb_build_object(
                'allowed', false,
                'code', 'UPGRADE_REQUIRED',
                'reason', 'Daily chat limit reached',
                'limit', limit_count,
                'used', used_count,
                'resetsAt', resets_at::text,
                'upgradeUrl', '/dashboard/settings/subscription',
                'cta', 'Upgrade to Pro for unlimited access'
            );
        END IF;
        UPDATE public.au_usage_daily
        SET chat_count = chat_count + COALESCE(p_count_inc, 0), updated_at = NOW()
        WHERE owner_id = p_owner_id AND day = day_utc;
        RETURN jsonb_build_object('allowed', true, 'billingEnabled', true, 'limit', limit_count, 'used', used_count + COALESCE(p_count_inc, 0), 'resetsAt', resets_at::text);
    ELSIF p_action = 'exam' THEN
        limit_count := COALESCE(cfg.free_exam_daily_limit, 0);
        used_count := COALESCE(u.exam_count, 0);
        IF used_count + COALESCE(p_count_inc, 0) > limit_count THEN
            RETURN jsonb_build_object(
                'allowed', false,
                'code', 'UPGRADE_REQUIRED',
                'reason', 'Daily exam limit reached',
                'limit', limit_count,
                'used', used_count,
                'resetsAt', resets_at::text,
                'upgradeUrl', '/dashboard/settings/subscription',
                'cta', 'Upgrade to Pro for unlimited access'
            );
        END IF;
        UPDATE public.au_usage_daily
        SET exam_count = exam_count + COALESCE(p_count_inc, 0), updated_at = NOW()
        WHERE owner_id = p_owner_id AND day = day_utc;
        RETURN jsonb_build_object('allowed', true, 'billingEnabled', true, 'limit', limit_count, 'used', used_count + COALESCE(p_count_inc, 0), 'resetsAt', resets_at::text);
    ELSIF p_action = 'upload' THEN
        limit_count := COALESCE(cfg.free_upload_daily_limit, 0);
        limit_mb := COALESCE(cfg.free_max_upload_mb, 0);
        used_count := COALESCE(u.upload_count, 0);
        used_mb := COALESCE(u.embed_mb, 0);

        IF used_count + COALESCE(p_count_inc, 0) > limit_count THEN
            RETURN jsonb_build_object(
                'allowed', false,
                'code', 'UPGRADE_REQUIRED',
                'reason', 'Daily upload limit reached',
                'limit', limit_count,
                'used', used_count,
                'resetsAt', resets_at::text,
                'upgradeUrl', '/dashboard/settings/subscription',
                'cta', 'Upgrade to Pro for unlimited access'
            );
        END IF;

        IF used_mb + COALESCE(p_mb_inc, 0) > limit_mb THEN
            RETURN jsonb_build_object(
                'allowed', false,
                'code', 'UPGRADE_REQUIRED',
                'reason', 'Daily upload size limit reached',
                'limit', limit_mb,
                'used', used_mb,
                'resetsAt', resets_at::text,
                'upgradeUrl', '/dashboard/settings/subscription',
                'cta', 'Upgrade to Pro for unlimited access'
            );
        END IF;

        UPDATE public.au_usage_daily
        SET
            upload_count = upload_count + COALESCE(p_count_inc, 0),
            embed_mb = embed_mb + COALESCE(p_mb_inc, 0),
            updated_at = NOW()
        WHERE owner_id = p_owner_id AND day = day_utc;

        RETURN jsonb_build_object(
            'allowed', true,
            'billingEnabled', true,
            'limit', limit_count,
            'used', used_count + COALESCE(p_count_inc, 0),
            'resetsAt', resets_at::text
        );
    ELSE
        RETURN jsonb_build_object('allowed', true, 'billingEnabled', true);
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.consume_au_usage_daily(UUID, TEXT, INT, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_au_usage_daily(UUID, TEXT, INT, NUMERIC) TO service_role;
