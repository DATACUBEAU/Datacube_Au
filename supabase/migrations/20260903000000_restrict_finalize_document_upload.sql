BEGIN;

-- finalize_document_upload is SECURITY DEFINER and accepts an explicit owner id.
-- PostgreSQL grants EXECUTE on newly-created functions to PUBLIC by default, so
-- browser roles must not be able to invoke this trusted ingestion primitive.
REVOKE ALL ON FUNCTION public.finalize_document_upload(
  uuid, uuid, uuid, uuid, text, text, text, text, bigint, jsonb, text
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.finalize_document_upload(
  uuid, uuid, uuid, uuid, text, text, text, text, bigint, jsonb, text
) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_document_upload(
  uuid, uuid, uuid, uuid, text, text, text, text, bigint, jsonb, text
) TO service_role;

-- Executable clean-rebuild invariant: this privileged RPC must remain callable
-- only from trusted server/service-role paths.
DO $$
DECLARE
  v_signature text := 'public.finalize_document_upload(uuid,uuid,uuid,uuid,text,text,text,text,bigint,jsonb,text)';
BEGIN
  IF has_function_privilege('anon', v_signature, 'EXECUTE') THEN
    RAISE EXCEPTION 'anon must not execute finalize_document_upload';
  END IF;

  IF has_function_privilege('authenticated', v_signature, 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated must not execute finalize_document_upload';
  END IF;

  IF NOT has_function_privilege('service_role', v_signature, 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role must retain finalize_document_upload execute privilege';
  END IF;
END
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
