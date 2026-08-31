-- Keep persisted admin usage deltas within JavaScript's exact integer range.
-- The API already constrains operator-entered amounts more tightly; this database
-- guard protects direct/internal callers and prevents Numeric values that cannot
-- be represented faithfully by the application usage resolver.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.au_usage_admin_adjustments'::regclass
      AND conname = 'au_usage_admin_adjustments_delta_safe_integer_chk'
  ) THEN
    ALTER TABLE public.au_usage_admin_adjustments
      ADD CONSTRAINT au_usage_admin_adjustments_delta_safe_integer_chk
      CHECK (
        delta >= -9007199254740991
        AND delta <= 9007199254740991
      ) NOT VALID;
  END IF;
END;
$$;

-- NOT VALID avoids making rollout depend on historical preview/test rows while
-- PostgreSQL still enforces the bound for every new or updated adjustment.

COMMIT;
