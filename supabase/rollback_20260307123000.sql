-- Rollback for 20260307123000_plan_reset_metadata.sql
-- Run this to revert changes if the migration causes issues.

BEGIN;

-- 1. Remove Triggers
DROP TRIGGER IF EXISTS trg_au_plan_metadata_updated_at ON public.au_plan_metadata;

-- 2. Remove Metadata Table
DROP TABLE IF EXISTS public.au_plan_metadata CASCADE;

-- 3. Remove Quota Windows Table
DROP TABLE IF EXISTS public.au_quota_windows CASCADE;

-- 4. Revert Plan Limits Table Modifications
ALTER TABLE public.au_plan_limits
  DROP COLUMN IF EXISTS tokens_reset_every_days,
  DROP COLUMN IF EXISTS chats_reset_every_days,
  DROP COLUMN IF EXISTS uploads_reset_every_days,
  DROP COLUMN IF EXISTS documents_reset_every_days,
  DROP COLUMN IF EXISTS exams_reset_every_days,
  DROP COLUMN IF EXISTS storage_reset_every_days;

-- 5. Revert Sync Function to previous state
CREATE OR REPLACE FUNCTION public.sync_feature_flags_to_legacy()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Prevent trigger ping-pong loops.
  IF pg_trigger_depth() > 1 THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'au_feature_flags'
  ) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.au_feature_flags WHERE key = OLD.key;
    RETURN OLD;
  END IF;

  INSERT INTO public.au_feature_flags (key, is_enabled, description, updated_at)
  VALUES (
    NEW.key,
    NEW.enabled,
    COALESCE(NEW.description, ''),
    COALESCE(NEW.updated_at, now())
  )
  ON CONFLICT (key) DO UPDATE
  SET is_enabled = EXCLUDED.is_enabled,
      description = EXCLUDED.description,
      updated_at = EXCLUDED.updated_at
  WHERE public.au_feature_flags.is_enabled IS DISTINCT FROM EXCLUDED.is_enabled
     OR public.au_feature_flags.description IS DISTINCT FROM EXCLUDED.description
     OR public.au_feature_flags.updated_at IS DISTINCT FROM EXCLUDED.updated_at;

  RETURN NEW;
END;
$$;

COMMIT;
