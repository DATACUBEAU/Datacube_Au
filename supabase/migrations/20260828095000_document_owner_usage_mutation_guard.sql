-- Canonical document/upload usage counts au_documents rows owned through either
-- owner_id or user_id. Keep the admin usage serialization version aligned with
-- both ownership columns so set/reset cannot commit against a stale upload count.

BEGIN;

CREATE OR REPLACE FUNCTION public.bump_document_usage_mutation_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_user_id UUID := NULL;
  v_old_owner_id UUID := NULL;
  v_new_user_id UUID := NULL;
  v_new_owner_id UUID := NULL;
  v_affected_user_id UUID;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    v_old_user_id := OLD.user_id;
    v_old_owner_id := OLD.owner_id;
  END IF;

  IF TG_OP <> 'DELETE' THEN
    v_new_user_id := NEW.user_id;
    v_new_owner_id := NEW.owner_id;
  END IF;

  -- A document may legitimately expose both columns, including divergent values
  -- during schema transitions. Bump each affected tenant exactly once per row mutation.
  FOR v_affected_user_id IN
    SELECT DISTINCT candidate
    FROM unnest(ARRAY[
      v_old_user_id,
      v_old_owner_id,
      v_new_user_id,
      v_new_owner_id
    ]::UUID[]) AS candidate
    WHERE candidate IS NOT NULL
  LOOP
    INSERT INTO public.au_usage_mutation_versions (user_id, version, updated_at)
    VALUES (v_affected_user_id, 1, now())
    ON CONFLICT (user_id) DO UPDATE
    SET version = public.au_usage_mutation_versions.version + 1,
        updated_at = now();
  END LOOP;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Older environments may not yet have owner_id. In those environments preserve
-- the generic user_id trigger installed by the preceding migration. Once both
-- ownership columns exist, replace only the document trigger with the stronger one.
DO $$
BEGIN
  IF to_regclass('public.au_documents') IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'au_documents'
      AND column_name = 'user_id'
  ) AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'au_documents'
      AND column_name = 'owner_id'
  ) THEN
    DROP TRIGGER IF EXISTS au_documents_bump_usage_mutation_version ON public.au_documents;
    CREATE TRIGGER au_documents_bump_usage_mutation_version
      AFTER INSERT OR UPDATE OR DELETE ON public.au_documents
      FOR EACH ROW
      EXECUTE FUNCTION public.bump_document_usage_mutation_version();
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
