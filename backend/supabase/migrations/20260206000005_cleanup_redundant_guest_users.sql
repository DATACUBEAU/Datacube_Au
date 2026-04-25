DO $$
DECLARE
  target_auth_user_id uuid;
  placeholder_id uuid := '00000000-0000-0000-0000-000000000001'::uuid;
  target_email text := 'fabiansazzy1214@gmail.com';
  orphaned_session_id uuid := 'f691026d-1feb-4d56-b202-d04edc23daf7'::uuid;
BEGIN
  SELECT id
  INTO target_auth_user_id
  FROM auth.users
  WHERE lower(email) = lower(target_email)
  ORDER BY created_at ASC
  LIMIT 1;

  IF target_auth_user_id IS NOT NULL THEN
    UPDATE public.au_sessions
    SET
      owner_id = target_auth_user_id,
      user_id = target_auth_user_id,
      guest_session_id = NULL,
      updated_at = now()
    WHERE id = orphaned_session_id;

    UPDATE public.au_messages
    SET
      owner_id = target_auth_user_id,
      user_id = target_auth_user_id,
      guest_session_id = NULL
    WHERE session_id = orphaned_session_id;

    UPDATE public.au_documents SET owner_id = target_auth_user_id, user_id = target_auth_user_id WHERE owner_id = placeholder_id;
    UPDATE public.au_document_chunks SET owner_id = target_auth_user_id, user_id = target_auth_user_id WHERE owner_id = placeholder_id;
    UPDATE public.au_sessions SET owner_id = target_auth_user_id, user_id = target_auth_user_id WHERE owner_id = placeholder_id;
    UPDATE public.au_messages SET owner_id = target_auth_user_id, user_id = target_auth_user_id WHERE owner_id = placeholder_id;
    UPDATE public.au_worker_jobs SET owner_id = target_auth_user_id, user_id = target_auth_user_id WHERE owner_id = placeholder_id;
  END IF;

  DELETE FROM public.au_users
  WHERE id = placeholder_id
    AND (target_auth_user_id IS NULL OR id <> target_auth_user_id);

  DELETE FROM auth.users
  WHERE id = placeholder_id
    AND (target_auth_user_id IS NULL OR id <> target_auth_user_id);

  DELETE FROM public.au_users au
  WHERE lower(au.email) = lower(target_email)
    AND (target_auth_user_id IS NULL OR au.id <> target_auth_user_id)
    AND au.id NOT IN (SELECT id FROM auth.users);
END $$;

DROP TABLE IF EXISTS public.guest_data CASCADE;

NOTIFY pgrst, 'reload schema';
