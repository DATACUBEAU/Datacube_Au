-- Extend the usage-mutation serialization boundary to every legacy/hybrid table
-- that can still influence canonical quota usage.
--
-- resolveCanonicalEffectiveLimits intentionally uses max(tracked, legacy) while old
-- production data is reconciled. Admin set/reset operations therefore must observe
-- mutations to those fallback sources, not only usage_counters/usage_totals.
-- This migration does not create a second counter and does not alter usage records;
-- it only advances the existing per-user mutation version in the same transaction.

BEGIN;

-- Make the shared trigger robust to an ownership change. An UPDATE that moves a row
-- between users changes canonical fallback usage for both users, so both versions must
-- advance. Existing counter triggers automatically inherit this stronger behavior.
CREATE OR REPLACE FUNCTION public.bump_usage_mutation_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_user_id UUID := NULL;
  v_new_user_id UUID := NULL;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    v_old_user_id := OLD.user_id;
  END IF;

  IF TG_OP <> 'DELETE' THEN
    v_new_user_id := NEW.user_id;
  END IF;

  IF v_old_user_id IS NOT NULL THEN
    INSERT INTO public.au_usage_mutation_versions (user_id, version, updated_at)
    VALUES (v_old_user_id, 1, now())
    ON CONFLICT (user_id) DO UPDATE
    SET version = public.au_usage_mutation_versions.version + 1,
        updated_at = now();
  END IF;

  IF v_new_user_id IS NOT NULL AND v_new_user_id IS DISTINCT FROM v_old_user_id THEN
    INSERT INTO public.au_usage_mutation_versions (user_id, version, updated_at)
    VALUES (v_new_user_id, 1, now())
    ON CONFLICT (user_id) DO UPDATE
    SET version = public.au_usage_mutation_versions.version + 1,
        updated_at = now();
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Attach the same transactionally-coupled version bump to every mutable fallback
-- source read by buildUsageSnapshotForUser:
--   au_messages       -> max_chats_total
--   au_model_usage    -> max_tokens_total
--   au_documents      -> max_uploads_total
--   au_feature_outputs-> predictions, practice exams, Knowledge Hub
--
-- The guards keep this migration backward-safe for older environments where a legacy
-- table may not exist yet. All current schemas expose user_id on these tables.
DO $$
DECLARE
  v_table TEXT;
  v_trigger TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'au_messages',
    'au_model_usage',
    'au_documents',
    'au_feature_outputs'
  ]
  LOOP
    IF to_regclass(format('public.%I', v_table)) IS NULL THEN
      CONTINUE;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = v_table
        AND column_name = 'user_id'
    ) THEN
      RAISE EXCEPTION 'usage fallback table public.% is missing required user_id column', v_table;
    END IF;

    v_trigger := v_table || '_bump_usage_mutation_version';
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', v_trigger, v_table);
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.bump_usage_mutation_version()',
      v_trigger,
      v_table
    );
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
