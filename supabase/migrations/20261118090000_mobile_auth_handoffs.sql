-- Short-lived, single-use handoffs from the existing website auth session to Android.
-- Tokens are encrypted by the Next.js server before insertion; this table is service-role only.
create table if not exists public.au_mobile_auth_handoffs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code_hash text not null unique,
  state_hash text not null,
  code_challenge text not null,
  refresh_token_ciphertext text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint au_mobile_auth_handoffs_code_hash_format
    check (code_hash ~ '^[0-9a-f]{64}$'),
  constraint au_mobile_auth_handoffs_state_hash_format
    check (state_hash ~ '^[0-9a-f]{64}$'),
  constraint au_mobile_auth_handoffs_challenge_format
    check (code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
  constraint au_mobile_auth_handoffs_expiry_after_creation
    check (expires_at > created_at)
);

create index if not exists au_mobile_auth_handoffs_user_expiry_idx
  on public.au_mobile_auth_handoffs (user_id, expires_at);

create index if not exists au_mobile_auth_handoffs_expiry_idx
  on public.au_mobile_auth_handoffs (expires_at);

alter table public.au_mobile_auth_handoffs enable row level security;

revoke all on table public.au_mobile_auth_handoffs from public, anon, authenticated;
grant all on table public.au_mobile_auth_handoffs to service_role;

comment on table public.au_mobile_auth_handoffs is
  'Five-minute PKCE-bound, single-use mobile authentication handoffs. Refresh tokens are AES-GCM encrypted by the server before storage.';
