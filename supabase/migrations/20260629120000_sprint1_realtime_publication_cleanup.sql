-- Sprint 1 Supabase egress reduction:
-- remove nonessential global/config/usage tables from the Realtime publication.
--
-- Rollback:
--   ALTER PUBLICATION supabase_realtime ADD TABLE public.feature_flags;
--   ALTER PUBLICATION supabase_realtime ADD TABLE public.usage_counters;
--   ALTER PUBLICATION supabase_realtime ADD TABLE public.plan_limits;
--   ALTER PUBLICATION supabase_realtime ADD TABLE public.au_plan_limit_rules;

DO $$
DECLARE
  realtime_table text;
  realtime_tables text[] := ARRAY[
    'feature_flags',
    'usage_counters',
    'plan_limits',
    'au_plan_limit_rules'
  ];
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication
    WHERE pubname = 'supabase_realtime'
  ) THEN
    RETURN;
  END IF;

  FOREACH realtime_table IN ARRAY realtime_tables LOOP
    IF to_regclass(format('public.%I', realtime_table)) IS NULL THEN
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = realtime_table
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I', realtime_table);
    END IF;
  END LOOP;
END $$;
