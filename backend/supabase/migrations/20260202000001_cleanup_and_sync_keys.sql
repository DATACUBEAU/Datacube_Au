-- Migration: Sync API Keys and Delete Obsolete Config
-- 20260202000001_cleanup_and_sync_keys.sql
--
-- Security note:
-- Historical provider key seed values were removed from this migration.
-- Provider keys must be configured through server-only admin APIs or
-- environment variables, never through tracked SQL migration files.

DO $$
BEGIN
  RAISE NOTICE 'Provider key seeding skipped; configure keys outside tracked migrations.';
END
$$;

NOTIFY pgrst, 'reload schema';
