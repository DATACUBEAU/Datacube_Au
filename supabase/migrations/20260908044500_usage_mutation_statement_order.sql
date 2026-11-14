-- Prevent ownership-transfer deadlocks in legacy/hybrid usage-version tracking.
--
-- The earlier row trigger bumped OLD.user_id and then NEW.user_id. Concurrent
-- opposite-direction ownership moves (A -> B and B -> A), or bulk updates whose row
-- order differed, could therefore lock au_usage_mutation_versions in opposite orders.
--
-- Replace the fallback-source row triggers with statement-level transition-table
-- triggers. Every affected user for one DML statement is collected first, deduplicated,
-- and bumped in stable UUID order. The document path includes both user_id and owner_id.
-- Counter/event accounting triggers are intentionally left unchanged; they have their
-- own canonical per-user serialization boundary.

BEGIN;

CREATE OR REPLACE FUNCTION public.bump_usage_mutation_versions_ordered(p_user_ids UUID[])
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  FOR v_user_id IN
    SELECT DISTINCT candidate
    FROM unnest(COALESCE(p_user_ids, ARRAY[]::UUID[])) AS candidate
    WHERE candidate IS NOT NULL
      AND EXISTS (SELECT 1 FROM auth.users WHERE id = candidate)
    ORDER BY candidate
  LOOP
    INSERT INTO public.au_usage_mutation_versions (user_id, version, updated_at)
    VALUES (v_user_id, 1, now())
    ON CONFLICT (user_id) DO UPDATE
    SET version = public.au_usage_mutation_versions.version + 1,
        updated_at = now();
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.bump_usage_mutation_versions_insert_statement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_ids UUID[];
BEGIN
  SELECT array_agg(DISTINCT user_id ORDER BY user_id)
  INTO v_user_ids
  FROM new_rows
  WHERE user_id IS NOT NULL;

  PERFORM public.bump_usage_mutation_versions_ordered(v_user_ids);
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.bump_usage_mutation_versions_update_statement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_ids UUID[];
BEGIN
  SELECT array_agg(DISTINCT user_id ORDER BY user_id)
  INTO v_user_ids
  FROM (
    SELECT user_id FROM old_rows WHERE user_id IS NOT NULL
    UNION
    SELECT user_id FROM new_rows WHERE user_id IS NOT NULL
  ) affected;

  PERFORM public.bump_usage_mutation_versions_ordered(v_user_ids);
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.bump_usage_mutation_versions_delete_statement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_ids UUID[];
BEGIN
  SELECT array_agg(DISTINCT user_id ORDER BY user_id)
  INTO v_user_ids
  FROM old_rows
  WHERE user_id IS NOT NULL;

  PERFORM public.bump_usage_mutation_versions_ordered(v_user_ids);
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.bump_document_usage_mutation_versions_insert_statement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_ids UUID[];
BEGIN
  SELECT array_agg(DISTINCT candidate ORDER BY candidate)
  INTO v_user_ids
  FROM (
    SELECT user_id AS candidate FROM new_rows WHERE user_id IS NOT NULL
    UNION
    SELECT owner_id AS candidate FROM new_rows WHERE owner_id IS NOT NULL
  ) affected;

  PERFORM public.bump_usage_mutation_versions_ordered(v_user_ids);
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.bump_document_usage_mutation_versions_update_statement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_ids UUID[];
BEGIN
  SELECT array_agg(DISTINCT candidate ORDER BY candidate)
  INTO v_user_ids
  FROM (
    SELECT user_id AS candidate FROM old_rows WHERE user_id IS NOT NULL
    UNION
    SELECT owner_id AS candidate FROM old_rows WHERE owner_id IS NOT NULL
    UNION
    SELECT user_id AS candidate FROM new_rows WHERE user_id IS NOT NULL
    UNION
    SELECT owner_id AS candidate FROM new_rows WHERE owner_id IS NOT NULL
  ) affected;

  PERFORM public.bump_usage_mutation_versions_ordered(v_user_ids);
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.bump_document_usage_mutation_versions_delete_statement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_ids UUID[];
BEGIN
  SELECT array_agg(DISTINCT candidate ORDER BY candidate)
  INTO v_user_ids
  FROM (
    SELECT user_id AS candidate FROM old_rows WHERE user_id IS NOT NULL
    UNION
    SELECT owner_id AS candidate FROM old_rows WHERE owner_id IS NOT NULL
  ) affected;

  PERFORM public.bump_usage_mutation_versions_ordered(v_user_ids);
  RETURN NULL;
END;
$$;

-- These functions are trigger-only implementation details. Keep ordinary PostgREST
-- roles from manufacturing mutation-version bumps directly.
REVOKE ALL ON FUNCTION public.bump_usage_mutation_versions_ordered(UUID[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bump_usage_mutation_versions_insert_statement() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bump_usage_mutation_versions_update_statement() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bump_usage_mutation_versions_delete_statement() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bump_document_usage_mutation_versions_insert_statement() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bump_document_usage_mutation_versions_update_statement() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bump_document_usage_mutation_versions_delete_statement() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  v_table TEXT;
  v_row_trigger TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'au_messages',
    'au_model_usage',
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

    v_row_trigger := v_table || '_bump_usage_mutation_version';
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', v_row_trigger, v_table);

    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', v_table || '_bump_usage_mutation_version_insert_stmt', v_table);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', v_table || '_bump_usage_mutation_version_update_stmt', v_table);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', v_table || '_bump_usage_mutation_version_delete_stmt', v_table);

    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT ON public.%I REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.bump_usage_mutation_versions_insert_statement()',
      v_table || '_bump_usage_mutation_version_insert_stmt',
      v_table
    );
    EXECUTE format(
      'CREATE TRIGGER %I AFTER UPDATE ON public.%I REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.bump_usage_mutation_versions_update_statement()',
      v_table || '_bump_usage_mutation_version_update_stmt',
      v_table
    );
    EXECUTE format(
      'CREATE TRIGGER %I AFTER DELETE ON public.%I REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.bump_usage_mutation_versions_delete_statement()',
      v_table || '_bump_usage_mutation_version_delete_stmt',
      v_table
    );
  END LOOP;
END;
$$;

-- au_documents can influence canonical upload usage through either user_id or owner_id.
DO $$
BEGIN
  IF to_regclass('public.au_documents') IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'au_documents' AND column_name = 'user_id'
  ) THEN
    RAISE EXCEPTION 'usage fallback table public.au_documents is missing required user_id column';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'au_documents' AND column_name = 'owner_id'
  ) THEN
    -- Older schemas without owner_id keep the generic semantics, but still use the
    -- statement-level ordered trigger family.
    DROP TRIGGER IF EXISTS au_documents_bump_usage_mutation_version ON public.au_documents;
    DROP TRIGGER IF EXISTS au_documents_bump_usage_mutation_version_insert_stmt ON public.au_documents;
    DROP TRIGGER IF EXISTS au_documents_bump_usage_mutation_version_update_stmt ON public.au_documents;
    DROP TRIGGER IF EXISTS au_documents_bump_usage_mutation_version_delete_stmt ON public.au_documents;

    CREATE TRIGGER au_documents_bump_usage_mutation_version_insert_stmt
      AFTER INSERT ON public.au_documents
      REFERENCING NEW TABLE AS new_rows
      FOR EACH STATEMENT
      EXECUTE FUNCTION public.bump_usage_mutation_versions_insert_statement();
    CREATE TRIGGER au_documents_bump_usage_mutation_version_update_stmt
      AFTER UPDATE ON public.au_documents
      REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
      FOR EACH STATEMENT
      EXECUTE FUNCTION public.bump_usage_mutation_versions_update_statement();
    CREATE TRIGGER au_documents_bump_usage_mutation_version_delete_stmt
      AFTER DELETE ON public.au_documents
      REFERENCING OLD TABLE AS old_rows
      FOR EACH STATEMENT
      EXECUTE FUNCTION public.bump_usage_mutation_versions_delete_statement();
    RETURN;
  END IF;

  DROP TRIGGER IF EXISTS au_documents_bump_usage_mutation_version ON public.au_documents;
  DROP TRIGGER IF EXISTS au_documents_bump_usage_mutation_version_insert_stmt ON public.au_documents;
  DROP TRIGGER IF EXISTS au_documents_bump_usage_mutation_version_update_stmt ON public.au_documents;
  DROP TRIGGER IF EXISTS au_documents_bump_usage_mutation_version_delete_stmt ON public.au_documents;

  CREATE TRIGGER au_documents_bump_usage_mutation_version_insert_stmt
    AFTER INSERT ON public.au_documents
    REFERENCING NEW TABLE AS new_rows
    FOR EACH STATEMENT
    EXECUTE FUNCTION public.bump_document_usage_mutation_versions_insert_statement();
  CREATE TRIGGER au_documents_bump_usage_mutation_version_update_stmt
    AFTER UPDATE ON public.au_documents
    REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
    FOR EACH STATEMENT
    EXECUTE FUNCTION public.bump_document_usage_mutation_versions_update_statement();
  CREATE TRIGGER au_documents_bump_usage_mutation_version_delete_stmt
    AFTER DELETE ON public.au_documents
    REFERENCING OLD TABLE AS old_rows
    FOR EACH STATEMENT
    EXECUTE FUNCTION public.bump_document_usage_mutation_versions_delete_statement();
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
