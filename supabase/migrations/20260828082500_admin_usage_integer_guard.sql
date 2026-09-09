-- Usage limits in Datacube AU are count/token based and must remain whole units.
-- Keep the persistence boundary defensive even if an internal caller bypasses the API.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.au_usage_admin_adjustments'::regclass
      AND conname = 'au_usage_admin_adjustments_delta_integer_chk'
  ) THEN
    ALTER TABLE public.au_usage_admin_adjustments
      ADD CONSTRAINT au_usage_admin_adjustments_delta_integer_chk
      CHECK (
        delta::text NOT IN ('NaN', 'Infinity', '-Infinity')
        AND delta = trunc(delta)
      ) NOT VALID;
  END IF;
END;
$$;

-- NOT VALID deliberately avoids making deployment depend on historical preview/test rows,
-- while PostgreSQL still enforces the check for every new or updated adjustment row.

COMMIT;
