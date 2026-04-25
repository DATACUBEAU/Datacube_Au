-- Fix auth -> au_users sync trigger permissions for Supabase Auth writes.
-- This keeps client-facing access unchanged and only hardens the internal auth path.

CREATE OR REPLACE FUNCTION public.sync_supabase_user_to_au_users()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    INSERT INTO public.au_users (id, provider, provider_uid, email, created_at, updated_at)
    VALUES (NEW.id, 'supabase', NEW.id::text, NEW.email, NEW.created_at, NEW.updated_at)
    ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email, updated_at = EXCLUDED.updated_at;

    INSERT INTO public.au_user_profiles (user_id, full_name, avatar_url, updated_at)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
        NEW.raw_user_meta_data->>'avatar_url',
        now()
    )
    ON CONFLICT (user_id) DO UPDATE
    SET
        full_name = EXCLUDED.full_name,
        avatar_url = EXCLUDED.avatar_url,
        updated_at = now();

    RETURN NEW;
END;
$$;

ALTER FUNCTION public.sync_supabase_user_to_au_users() OWNER TO postgres;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA public TO supabase_auth_admin';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON TABLE public.au_users TO supabase_auth_admin';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON TABLE public.au_user_profiles TO supabase_auth_admin';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.sync_supabase_user_to_au_users() TO supabase_auth_admin';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
