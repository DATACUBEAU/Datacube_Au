-- Harden privileged billing/admin mutation boundaries.
--
-- These functions are SECURITY DEFINER state-transition primitives and must
-- not be directly executable by browser roles. Billing renewal attempt rows
-- are likewise server-owned operational state.
--
-- This migration is permission-only: it does not modify billing rows,
-- entitlements, subscriptions, plans, or document-retention data.

BEGIN;

ALTER TABLE public.billing_renewal_attempts ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.billing_renewal_attempts
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.apply_billing_renewal_failure(
  UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TIMESTAMPTZ,
  BOOLEAN, JSONB, BIGINT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.apply_billing_renewal_failure(
  UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TIMESTAMPTZ,
  BOOLEAN, JSONB, BIGINT, TEXT, TEXT
) TO service_role;

REVOKE ALL ON FUNCTION public.admin_set_user_plan_override(
  UUID, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.admin_set_user_plan_override(
  UUID, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT
) TO service_role;

REVOKE ALL ON FUNCTION public.approve_manual_payment(
  UUID, UUID, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.approve_manual_payment(
  UUID, UUID, TEXT
) TO service_role;

ALTER FUNCTION public.approve_manual_payment(UUID, UUID, TEXT)
  SET search_path = public, auth;

REVOKE ALL ON FUNCTION public.apply_plan_transition(
  UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.apply_plan_transition(
  UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB
) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
