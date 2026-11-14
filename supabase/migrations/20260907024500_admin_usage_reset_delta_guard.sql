-- Keep reset audit semantics aligned with the persisted usage effect.
--
-- A reset may legitimately be a negative correction or a durable zero-delta
-- idempotency receipt, but it must never increase usage. Enforce this invariant
-- at the append-only ledger boundary so no wrapper/internal caller can persist a
-- positive delta while labelling the operation as a reset.

BEGIN;

ALTER TABLE public.au_usage_admin_adjustments
  DROP CONSTRAINT IF EXISTS au_usage_admin_adjustments_reset_delta_chk;

ALTER TABLE public.au_usage_admin_adjustments
  ADD CONSTRAINT au_usage_admin_adjustments_reset_delta_chk
  CHECK (action <> 'reset' OR delta <= 0) NOT VALID;

COMMIT;
