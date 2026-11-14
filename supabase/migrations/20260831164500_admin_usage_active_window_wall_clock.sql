-- Use serialized wall-clock time for authoritative admin usage-window validation.
--
-- PostgreSQL now() is transaction-start stable. An admin correction transaction can
-- begin inside a finite quota window, wait on accounting/advisory locks until after
-- the reset boundary, and still pass a trigger that compares against now(). The
-- append-only adjustment ledger must decide freshness at the actual persistence
-- boundary instead, so use clock_timestamp() for finite-window admission.

BEGIN;

CREATE OR REPLACE FUNCTION public.assert_admin_usage_adjustment_active_window()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wall_clock TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF NEW.window_start IS NULL THEN
    RAISE EXCEPTION 'usage_adjustment_window_required' USING ERRCODE = '22023';
  END IF;

  IF NEW.window_end IS NOT NULL THEN
    IF NEW.window_end <= NEW.window_start THEN
      RAISE EXCEPTION 'invalid_usage_adjustment_window' USING ERRCODE = '22023';
    END IF;

    IF v_wall_clock < NEW.window_start OR v_wall_clock >= NEW.window_end THEN
      RAISE EXCEPTION 'usage_adjustment_window_stale'
        USING ERRCODE = '40001',
              DETAIL = 'The quota window changed before the usage correction was committed. Refresh and retry.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_admin_usage_adjustment_active_window() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_admin_usage_adjustment_active_window() TO service_role;

COMMIT;
