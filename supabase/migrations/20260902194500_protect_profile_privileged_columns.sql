BEGIN;

-- au_user_profiles started as a user-editable profile row and later gained
-- authorization and billing-controlled columns (for example role/tier/Stripe
-- state). The existing owner UPDATE policy is row-scoped, not column-scoped.
-- Remove broad direct UPDATE privileges from browser roles and explicitly
-- re-grant only the fields an authenticated user is allowed to edit.
--
-- RLS continues to ensure an authenticated user can update only their own row.
-- service_role privileges are intentionally left unchanged for trusted server
-- billing/admin flows.

REVOKE UPDATE ON TABLE public.au_user_profiles FROM anon, authenticated;
GRANT UPDATE (full_name, avatar_url) ON TABLE public.au_user_profiles TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
