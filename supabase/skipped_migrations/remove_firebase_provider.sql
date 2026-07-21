ALTER TABLE public.au_users
  DROP CONSTRAINT IF EXISTS au_users_provider_check;

ALTER TABLE public.au_users
  ADD CONSTRAINT au_users_provider_check
  CHECK (provider = 'supabase');
