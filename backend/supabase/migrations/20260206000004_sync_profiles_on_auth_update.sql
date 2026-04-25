CREATE OR REPLACE FUNCTION public.sync_supabase_user_to_au_users()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created_sync_au ON auth.users;
DROP TRIGGER IF EXISTS on_auth_user_updated_sync_au ON auth.users;

CREATE TRIGGER on_auth_user_created_sync_au
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.sync_supabase_user_to_au_users();

CREATE TRIGGER on_auth_user_updated_sync_au
AFTER UPDATE OF email, raw_user_meta_data ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.sync_supabase_user_to_au_users();

INSERT INTO public.au_user_profiles (user_id, full_name, avatar_url, updated_at)
SELECT
  id,
  COALESCE(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name'),
  raw_user_meta_data->>'avatar_url',
  now()
FROM auth.users
ON CONFLICT (user_id) DO UPDATE
SET
  full_name = EXCLUDED.full_name,
  avatar_url = EXCLUDED.avatar_url,
  updated_at = now();

NOTIFY pgrst, 'reload schema';
