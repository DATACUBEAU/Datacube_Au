-- Force update of Paystack Plan Codes
-- Timestamp: 20260213000000

-- 1. Ensure correct plans exist
INSERT INTO public.au_billing_plans (provider, plan_code, interval, amount_ngn, name)
VALUES 
    ('paystack', 'PLN_bc7vhwfff2mqc57', 'weekly', 1900, 'Pro Weekly'),
    ('paystack', 'PLN_axsdw7s4zniurzr', 'monthly', 4500, 'Pro Monthly')
ON CONFLICT (plan_code) DO UPDATE SET 
    interval = EXCLUDED.interval,
    amount_ngn = EXCLUDED.amount_ngn,
    name = EXCLUDED.name,
    is_active = true;

-- 2. Disable/Remove old placeholders if they persist
DELETE FROM public.au_billing_plans WHERE plan_code IN ('PLN_weekly_placeholder', 'PLN_monthly_placeholder');
