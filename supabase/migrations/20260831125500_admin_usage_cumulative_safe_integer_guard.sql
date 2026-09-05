-- Keep the serialized cumulative admin-usage adjustment total inside JavaScript's
-- exact integer range. Individual deltas are already bounded, but multiple valid
-- rows can otherwise sum beyond Number.MAX_SAFE_INTEGER and make PostgreSQL quota
-- enforcement disagree with TypeScript usage presentation and expected-total CAS.
--
-- The ledger is append-only, so enforce this immediately before INSERT. Acquire the
-- same per-user/metric/window advisory lock used by the checked mutation RPC so the
-- sum plus the incoming delta is concurrency-safe even for trusted internal inserts.

BEGIN;

CREATE OR REPLACE FUNCTION public.assert_admin_usage_adjustment_cumulative_safe_integer()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_total NUMERIC := 0;
  v_next_total NUMERIC := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      concat_ws(
        '|',
        NEW.user_id::TEXT,
        NEW.metric_key,
        NEW.window_start::TEXT,
        COALESCE(NEW.window_end::TEXT, '')
      ),
      0
    )
  );

  SELECT COALESCE(SUM(delta), 0)
  INTO v_total
  FROM public.au_usage_admin_adjustments
  WHERE user_id = NEW.user_id
    AND metric_key = NEW.metric_key
    AND window_start = NEW.window_start
    AND ((window_end IS NULL AND NEW.window_end IS NULL) OR window_end = NEW.window_end);

  v_next_total := v_total + NEW.delta;

  IF v_next_total < -9007199254740991 OR v_next_total > 9007199254740991 THEN
    RAISE EXCEPTION 'usage_adjustment_total_out_of_range'
      USING ERRCODE = '22003',
            DETAIL = 'The cumulative usage adjustment must remain within the exact integer range supported by the application.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS au_usage_admin_adjustments_cumulative_safe_integer_guard
  ON public.au_usage_admin_adjustments;

CREATE TRIGGER au_usage_admin_adjustments_cumulative_safe_integer_guard
BEFORE INSERT ON public.au_usage_admin_adjustments
FOR EACH ROW
EXECUTE FUNCTION public.assert_admin_usage_adjustment_cumulative_safe_integer();

REVOKE ALL ON FUNCTION public.assert_admin_usage_adjustment_cumulative_safe_integer() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.assert_admin_usage_adjustment_cumulative_safe_integer() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.assert_admin_usage_adjustment_cumulative_safe_integer() FROM anon;

NOTIFY pgrst, 'reload schema';

COMMIT;
