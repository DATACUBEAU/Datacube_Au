-- Allow only explicit, auditable zero-delta completion receipts in the admin usage ledger.
--
-- The no-op idempotency migration persists successful set/reset operations with
-- delta = 0 so retries cannot later mutate newly accrued usage. The original
-- table-level CHECK (delta <> 0) predates that behavior and would reject those
-- receipts at runtime. Replace it with a narrow invariant: non-zero adjustments
-- remain valid as before, while zero is allowed only for set/reset rows that are
-- explicitly marked context.no_op = true.

BEGIN;

ALTER TABLE public.au_usage_admin_adjustments
  DROP CONSTRAINT IF EXISTS au_usage_admin_adjustments_delta_check;

ALTER TABLE public.au_usage_admin_adjustments
  ADD CONSTRAINT au_usage_admin_adjustments_delta_check
  CHECK (
    delta <> 0
    OR (
      delta = 0
      AND action IN ('set', 'reset')
      AND context @> '{"no_op": true}'::jsonb
    )
  );

COMMIT;
