-- Prevent usage adjustments from being persisted into inactive finite quota windows.
--
-- API-side window checks can race a reset boundary, and trusted/direct RPC callers
-- can otherwise supply a past or future finite window. Keep this temporal invariant
-- at the append-only ledger boundary so every write path receives the same guard.
-- `never`/lifetime adjustments intentionally use a NULL window_end and remain valid.

BEGIN;

CREATE OR REPLACE FUNCTION public.assert_admin_usage_adjustment_active_window()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := now();
BEGIN
  IF NEW.window_start IS NULL THEN
    RAISE EXCEPTION 'usage_adjustment_window_required' USING ERRCODE = '22023';
  END IF;

  IF NEW.window_end IS NOT NULL THEN
    IF NEW.window_end <= NEW.window_start THEN
      RAISE EXCEPTION 'invalid_usage_adjustment_window' USING ERRCODE = '22023';
    END IF;

    IF v_now < NEW.window_start OR v_now >= NEW.window_end THEN
      RAISE EXCEPTION 'usage_adjustment_window_stale'
        USING ERRCODE = '40001',
              DETAIL = 'The quota window changed before the usage correction was committed. Refresh and retry.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_au_usage_admin_adjustments_active_window
ON public.au_usage_admin_adjustments;

CREATE TRIGGER trg_au_usage_admin_adjustments_active_window
BEFORE INSERT OR UPDATE OF window_start, window_end
ON public.au_usage_admin_adjustments
FOR EACH ROW
EXECUTE FUNCTION public.assert_admin_usage_adjustment_active_window();

REVOKE ALL ON FUNCTION public.assert_admin_usage_adjustment_active_window() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_admin_usage_adjustment_active_window() TO service_role;

COMMIT;
