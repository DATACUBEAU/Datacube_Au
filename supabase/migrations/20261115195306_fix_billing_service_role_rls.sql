-- Billing control-plane tables contain payment, customer, subscription and entitlement state.
-- Browser roles must use authenticated server APIs/RPCs; direct table DML is server-only.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['billing_customers','billing_plans','billing_subscriptions','billing_transactions','billing_webhook_events','billing_renewal_attempts','entitlement_grants']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL PRIVILEGES ON TABLE public.%I TO service_role', t);
  END LOOP;
END;
$$;
