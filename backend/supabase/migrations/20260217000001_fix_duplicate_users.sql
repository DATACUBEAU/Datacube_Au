-- Fix duplicates and enforce consistency

-- 1. Delete orphans (users in au_users not in auth.users)
DELETE FROM public.au_users
WHERE id NOT IN (SELECT id FROM auth.users);

-- 2. Sync emails from auth.users to ensure consistency and prevent case-sensitivity issues
UPDATE public.au_users au
SET email = a.email
FROM auth.users a
WHERE au.id = a.id
AND au.email IS DISTINCT FROM a.email;

-- 3. Add Foreign Key Constraint (if not exists)
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'au_users_id_fkey') THEN
    ALTER TABLE public.au_users
    ADD CONSTRAINT au_users_id_fkey
    FOREIGN KEY (id)
    REFERENCES auth.users(id)
    ON DELETE CASCADE;
  END IF;
END $$;

-- 4. Add Unique Index on lower(email)
CREATE UNIQUE INDEX IF NOT EXISTS au_users_email_idx ON public.au_users (lower(email));

-- 5. RPC for consistency
CREATE OR REPLACE FUNCTION public.ensure_user_consistency()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    curr_user_id uuid;
    curr_email text;
    curr_meta jsonb;
BEGIN
    curr_user_id := auth.uid();
    IF curr_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    SELECT email, raw_user_meta_data INTO curr_email, curr_meta
    FROM auth.users
    WHERE id = curr_user_id;

    -- Upsert into au_users
    INSERT INTO public.au_users (id, provider, provider_uid, email, updated_at)
    VALUES (curr_user_id, 'supabase', curr_user_id::text, curr_email, now())
    ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email, updated_at = EXCLUDED.updated_at;

    -- Upsert into au_user_profiles
    INSERT INTO public.au_user_profiles (user_id, full_name, avatar_url, updated_at)
    VALUES (
        curr_user_id, 
        COALESCE(curr_meta->>'full_name', curr_meta->>'name'),
        curr_meta->>'avatar_url',
        now()
    )
    ON CONFLICT (user_id) DO UPDATE
    SET 
        full_name = COALESCE(EXCLUDED.full_name, public.au_user_profiles.full_name),
        avatar_url = COALESCE(EXCLUDED.avatar_url, public.au_user_profiles.avatar_url),
        updated_at = EXCLUDED.updated_at;

END;
$$;
