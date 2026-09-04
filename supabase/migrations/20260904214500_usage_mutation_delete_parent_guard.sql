-- Keep usage-version triggers from recreating auth-owned child rows while a user is
-- being deleted. Counter/legacy rows can be removed by ON DELETE CASCADE during the
-- parent auth.users deletion; their AFTER DELETE triggers must not insert a fresh
-- au_usage_mutation_versions row that references the disappearing parent.
--
-- Normal usage mutations still bump the existing per-user version exactly as before.

BEGIN;

CREATE OR REPLACE FUNCTION public.bump_usage_mutation_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
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

  IF v_old_user_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM auth.users WHERE id = v_old_user_id) THEN
    INSERT INTO public.au_usage_mutation_versions (user_id, version, updated_at)
    VALUES (v_old_user_id, 1, now())
    ON CONFLICT (user_id) DO UPDATE
    SET version = public.au_usage_mutation_versions.version + 1,
        updated_at = now();
  END IF;

  IF v_new_user_id IS NOT NULL
     AND v_new_user_id IS DISTINCT FROM v_old_user_id
     AND EXISTS (SELECT 1 FROM auth.users WHERE id = v_new_user_id) THEN
    INSERT INTO public.au_usage_mutation_versions (user_id, version, updated_at)
    VALUES (v_new_user_id, 1, now())
    ON CONFLICT (user_id) DO UPDATE
    SET version = public.au_usage_mutation_versions.version + 1,
        updated_at = now();
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.bump_document_usage_mutation_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
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

  FOR v_affected_user_id IN
    SELECT DISTINCT candidate
    FROM unnest(ARRAY[
      v_old_user_id,
      v_old_owner_id,
      v_new_user_id,
      v_new_owner_id
    ]::UUID[]) AS candidate
    WHERE candidate IS NOT NULL
      AND EXISTS (SELECT 1 FROM auth.users WHERE id = candidate)
    ORDER BY candidate
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

NOTIFY pgrst, 'reload schema';

COMMIT;
