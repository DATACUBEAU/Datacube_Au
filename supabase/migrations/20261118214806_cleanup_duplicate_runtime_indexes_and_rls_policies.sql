-- Recovered production ledger version; original SQL archived under docs/audits/migration-ledger-originals.
-- Historical installations may lack legacy relations/policies; do not recreate retired objects.
-- Existing objects receive the same policy changes as the production ledger.
DO $p0_replay$
BEGIN
  DROP INDEX IF EXISTS public.idx_au_admin_email_alerts_event_type;

  DROP INDEX IF EXISTS public.idx_au_model_usage_created_at_desc;

  IF to_regclass('public.au_api_keys') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Service role can access keys" ON public.au_api_keys;
  END IF;

  IF to_regclass('public.au_api_keys') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Service role only" ON public.au_api_keys;
  END IF;

  IF to_regclass('public.au_quota_windows') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Users can view own quota windows" ON public.au_quota_windows;
  END IF;

  IF to_regclass('public.au_user_activity') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Users can insert own activity" ON public.au_user_activity;
  END IF;

  IF to_regclass('public.au_user_activity') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Users can view own activity" ON public.au_user_activity;
  END IF;

  IF to_regclass('public.au_user_activity') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Users can update own activity" ON public.au_user_activity;
  END IF;
END;
$p0_replay$;
