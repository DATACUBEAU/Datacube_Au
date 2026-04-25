-- Update Paystack Plan Codes
-- Timestamp: 20260211120000

INSERT INTO public.au_billing_plans (provider, plan_code, interval, amount_ngn, name)
VALUES 
    ('paystack', 'PLN_bc7vhwfff2mqc57', 'weekly', 1900, 'Pro Weekly'),
    ('paystack', 'PLN_axsdw7s4zniurzr', 'monthly', 4500, 'Pro Monthly')
ON CONFLICT (plan_code) DO NOTHING;

-- Optionally remove placeholders if they exist and differ
DELETE FROM public.au_billing_plans WHERE plan_code IN ('PLN_weekly_placeholder', 'PLN_monthly_placeholder');
