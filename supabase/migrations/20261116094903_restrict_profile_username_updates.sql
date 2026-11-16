-- Username changes use the dedicated validated username flow. Direct profile
-- updates are limited to display name and avatar only.
REVOKE UPDATE (username) ON TABLE public.au_user_profiles FROM authenticated;
NOTIFY pgrst, 'reload schema';
