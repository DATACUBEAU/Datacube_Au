-- Keep admin set/reset serialization aligned with canonical usage windows reconstructed
-- from the append-only usage-event ledger.
--
-- Daily/lifetime accounting already advances au_usage_mutation_versions through
-- usage_counters/usage_totals. Hourly, weekly, monthly, and custom windows can be
-- reconstructed directly from au_usage_events, including commit_ai_usage inserts
-- that do not perform another counter mutation at commit time. Without a trigger on
-- the event ledger, such a commit can occur after an admin snapshot while leaving the
-- observed mutation version unchanged.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.au_usage_events') IS NULL THEN
    RAISE EXCEPTION 'required usage ledger public.au_usage_events is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'au_usage_events'
      AND column_name = 'user_id'
  ) THEN
    RAISE EXCEPTION 'usage ledger public.au_usage_events is missing required user_id column';
  END IF;

  DROP TRIGGER IF EXISTS au_usage_events_bump_usage_mutation_version ON public.au_usage_events;
  CREATE TRIGGER au_usage_events_bump_usage_mutation_version
  AFTER INSERT OR UPDATE OR DELETE ON public.au_usage_events
  FOR EACH ROW EXECUTE FUNCTION public.bump_usage_mutation_version();
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
