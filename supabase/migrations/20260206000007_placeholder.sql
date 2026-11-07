ALTER TABLE public.au_user_profiles
ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user';

UPDATE public.au_user_profiles
SET role = 'user'
WHERE role IS NULL;

NOTIFY pgrst, 'reload schema';
