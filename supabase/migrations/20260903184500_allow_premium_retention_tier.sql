BEGIN;

-- Premium is a canonical managed plan and receives the same 30-day document
-- retention window as paid Pro. The production retention metadata constraint
-- predates Premium support and would reject durable `retention_tier = 'premium'`
-- attribution even though the application policy recognizes that plan.
-- Widen the metadata vocabulary only; do not rewrite existing document rows or
-- change any expiry timestamps in this migration.

ALTER TABLE public.au_documents
  DROP CONSTRAINT IF EXISTS au_documents_retention_tier_check;

ALTER TABLE public.au_documents
  ADD CONSTRAINT au_documents_retention_tier_check
  CHECK (
    retention_tier IS NULL
    OR retention_tier IN ('free', 'promo', 'pro', 'premium')
  )
  NOT VALID;

DO $$
DECLARE
  v_definition TEXT;
BEGIN
  SELECT pg_get_constraintdef(c.oid)
  INTO v_definition
  FROM pg_constraint c
  WHERE c.conname = 'au_documents_retention_tier_check'
    AND c.conrelid = 'public.au_documents'::regclass;

  IF v_definition IS NULL
     OR v_definition NOT LIKE '%premium%' THEN
    RAISE EXCEPTION 'premium_retention_tier_constraint_missing';
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
