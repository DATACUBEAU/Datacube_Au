-- Prevent authenticated users from modifying entitlement, billing, role,
-- identity, and activity fields through direct profile table updates.
-- Users retain the supported profile-editing fields; RLS continues to scope
-- reads and updates to their own profile row.

REVOKE ALL PRIVILEGES ON TABLE public.au_user_profiles FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.au_user_profiles TO authenticated;
GRANT UPDATE (full_name, avatar_url, username)
  ON TABLE public.au_user_profiles TO authenticated;

GRANT ALL PRIVILEGES ON TABLE public.au_user_profiles TO service_role;

NOTIFY pgrst, 'reload schema';
