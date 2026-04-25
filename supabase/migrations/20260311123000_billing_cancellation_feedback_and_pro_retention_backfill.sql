BEGIN;

CREATE TABLE IF NOT EXISTS public.billing_cancellation_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subscription_id BIGINT NULL REFERENCES public.billing_subscriptions(id) ON DELETE SET NULL,
  plan_key TEXT NULL,
  subscription_status TEXT NULL,
  gateway TEXT NOT NULL DEFAULT 'paystack',
  cancellation_mode TEXT NOT NULL DEFAULT 'local_schedule',
  cancellation_reason TEXT NOT NULL,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ NULL,
  deleted_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_billing_cancellation_feedback_created_at
  ON public.billing_cancellation_feedback(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_cancellation_feedback_user_id
  ON public.billing_cancellation_feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_billing_cancellation_feedback_deleted_at
  ON public.billing_cancellation_feedback(deleted_at);

ALTER TABLE public.billing_cancellation_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "billing_cancellation_feedback_service_role" ON public.billing_cancellation_feedback;
CREATE POLICY "billing_cancellation_feedback_service_role"
ON public.billing_cancellation_feedback
FOR ALL
TO service_role
USING (TRUE)
WITH CHECK (TRUE);

DROP POLICY IF EXISTS "billing_cancellation_feedback_select_own" ON public.billing_cancellation_feedback;
CREATE POLICY "billing_cancellation_feedback_select_own"
ON public.billing_cancellation_feedback
FOR SELECT
TO authenticated
USING (user_id = auth.uid() OR public.is_conex_admin(auth.uid()));

GRANT SELECT ON public.billing_cancellation_feedback TO authenticated;

UPDATE public.au_plan_metadata
SET
  retention_days = GREATEST(COALESCE(retention_days, 0), 30),
  expiration_days = GREATEST(COALESCE(expiration_days, 0), 30),
  updated_at = now()
WHERE plan = 'pro';

COMMIT;

NOTIFY pgrst, 'reload schema';
