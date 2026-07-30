# DataCube AU API Key Pipeline Audit

Last updated: 2026-07-29

Status model:

- Green = fixed and verified in repo/tests
- Yellow = partly fixed or needs live verification
- Red = confirmed unsafe until rotation or manual remediation is complete
- Grey = cannot verify from repo alone

No raw secret values are included in this report.

## Executive Status

| Area | Status | Result |
|---|---|---|
| Browser/provider-key exposure | Green | Admin provider-key DTOs expose only configured status, last4/fingerprint, provider name, timestamps, and status fields. |
| Legacy Conex admin token pipeline | Green | Custom admin token storage/header flow was removed from the browser. Old stored values are cleanup-only. |
| Tracked secret exposure cleanup | Yellow | Confirmed tracked historical credential values were removed. The owner reports credential rotation is complete and the browser now uses the corrected Supabase publishable key. Live post-rotation smoke tests are still pending. |
| Secret table controls | Yellow | Credential metadata/audit hardening and provider-key encryption metadata migrations are applied remotely. New provider-key create/update paths now use server-side encrypted storage metadata and masked DTOs, but the code/env still need deployment/live verification and legacy plaintext rows must be re-entered or rotated. |
| Public/service-worker exposure | Green | Static checks assert no high-confidence raw secret values or credential plumbing in tracked public files. |

## Supabase Migration Retry Status

Migration file: `supabase/migrations/20260728120000_api_key_pipeline_hardening.sql`

Local fix applied after the failed remote push: all provider/admin key fingerprints now use `extensions.digest(convert_to(..., 'UTF8'), 'sha256')`, and `pgcrypto` is created in the Supabase `extensions` schema. The `au_api_keys` metadata/backfill block is guarded so a retry is safe if the earlier failed push created some objects before aborting.

Pre-push migration list showed `20260728120000` as local-only, so the failed earlier push was not marked applied. A schema-only inspection path was blocked by the local Docker/Colima requirement, but the migration itself is idempotent for retry. The dry run listed only `20260728120000_api_key_pipeline_hardening.sql`, so the migration was pushed automatically. Post-push verification shows `20260728120000` applied remotely and `npx supabase db push --dry-run` returns `Remote database is up to date.`

Remote schema metadata confirms the provider key audit table exists, the `au_api_keys` metadata columns exist, and the `au_config` cleanup columns exist. The optional `au_key_groups` table is not present in the generated public schema. Direct live policy catalog verification is still pending because follow-up CLI metadata connections began failing with temporary Supabase pooler authentication/circuit-breaker errors.

## Secret Categories Audited

| Secret category | Primary storage | Components that use it | Browser-visible | Status | Required action |
|---|---|---|---|---|---|
| Supabase anon/publishable key | `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_ANON_KEY` | Browser client, server proxy calls | Yes, by design | Green | Owner reports the browser publishable-key replacement is complete; keep scoped as anon/publishable only. |
| Supabase service-role / secret key | Server env only | Next.js admin APIs, RAG worker, VPS gateway optional server reads | No | Yellow | Owner reports rotation complete; run frontend/server, Oracle VPS, RAG worker, and cron/background smoke tests before marking Green. |
| Supabase JWT secret references | Env/config references only | Supabase Auth/JWT validation context | No | Grey | Verify live Supabase project secret never appears in repo, logs, or generated files. |
| `VPS_SHARED_SECRET` | Next.js server env and Oracle VPS env | `/api/au/vps-ticket`, VPS gateway verifier | No raw value; short-lived ticket is browser-visible by design | Yellow | Ensure matching values on Next.js and Oracle VPS; rotate after deploy if exposure suspected. |
| Qdrant API key | Server/VPS/worker env | VPS gateway retrieval, RAG worker, retention/repair tools | No | Green | Keep off `NEXT_PUBLIC_*`; verify Oracle VPS log redaction. |
| OpenAI API key | VPS env or provider table if configured | Gateway provider router / server model router | No | Green | Rotate any historical exposed provider keys; keep server-only. |
| OpenRouter API key | VPS env or `au_api_keys` / `ai_provider_keys` | Gateway provider router / server model router | No | Yellow | Owner reports rotation complete; re-enter database-stored provider keys through the encrypted admin path and verify live provider calls. |
| Anthropic API key | VPS env | Gateway provider router | No | Green | Keep server-only and out of logs. |
| Google/Gemini API key | Env if present | Provider router if added later | No | Grey | No active repo path confirmed in this pass. |
| Paystack secret key | Server env | `src/lib/server/paystack.ts`, billing sessions/webhooks | No | Green | Keep server-only, rotate if deployment logs ever exposed. |
| Paystack public key | Public env/config if used | Browser checkout | Yes, by design | Green | Public key only; never substitute secret key. |
| Flutterwave secret key | Server env | `src/lib/payments/flutterwave.ts`, webhook route | No | Green | Keep server-only. |
| Flutterwave public key | Public env/config if used | Browser checkout | Yes, by design | Green | Public key only. |
| Webhook secrets | Server env | Paystack/Flutterwave webhook verification | No | Green | Keep no-store responses and bounded request bodies. |
| Admin override credentials | Historical `au_admin_config`; current protected-owner authorization uses server-only `DATACUBE_OWNER_ADMIN_USER_ID` | Server/db/env only | No | Yellow | Owner reports rotation complete; verify the server-only owner env is configured in deployment and no legacy admin credential remains active. |
| Provider registry keys | `au_api_keys` / optional `ai_provider_keys` | Admin handler, server AI routing | No | Yellow | New create/update stores encrypted values server-side; legacy plaintext rows must be re-entered/rotated. |
| Model routing provider keys | Same as provider registry | Server AI routing | No | Yellow | Server-side decrypt is used for encrypted rows; plaintext fallback remains only for legacy rows until rotation/re-entry is complete. |
| Generated signed VPS ticket | Generated by `/api/au/vps-ticket` | Browser sends to VPS gateway | Yes, short-lived bearer | Yellow | Keep 5-minute TTL, route binding, no logging, no persistence. |
| Authorization bearer token | Supabase session/browser requests; VPS ticket/gateway requests | Browser, Next.js, VPS | Yes for active sessions | Green | Do not persist in offline queue; never log. |
| Refresh token | Supabase auth storage | Browser Supabase client | Yes, managed by Supabase client | Yellow | Verify browser storage configuration and sign-out cleanup in live clients. |
| Cookie/session token | Browser cookies/session | Next.js auth | Yes, by design | Green | No service worker caching of private API responses. |

## Credential Tables

| Table | Columns / secret fields | Access and code paths | RLS / service-role status | Browser risk | Status |
|---|---|---|---|---|---|
| `public.au_api_keys` | Encrypted: `encrypted_key_value`; legacy raw fallback: `key_value`; masked: `key_last4`, `key_fingerprint`; metadata: `rotated_at`, `revoked_at`, `last_used_at`, `created_by`, `updated_by`, `key_encryption_version`, `key_encrypted_at`, `key_reference` | `src/app/api/admin/handler/route.ts`, `src/lib/server/ai-routing.ts` | RLS enabled, anon/authenticated revoked, service_role granted. New admin create/update writes encrypted value and nulls `key_value`; server AI routing decrypts encrypted rows server-side only. | Admin browser gets masked DTO only. | Yellow |
| `public.ai_provider_keys` | Optional compat table with possible `encrypted_key_value` or legacy `key_value`; metadata columns added if it is a real table | `src/lib/server/ai-routing.ts` fallback | Migration hardens if table exists as a table. | No browser route should expose it. | Yellow |
| `public.au_key_groups` | Historical `api_key`; migration adds masked metadata, and encryption-reference columns if table exists | No active current app path found | Migration hardens if table exists. | Not browser-facing in current repo. | Yellow |
| `public.au_admin_config` | Historical `challenge_answer` and `admin_access_key` seed values | Legacy backend migration only in tracked repo; current owner authorization is env-backed | Historical raw values removed from migration; owner reports rotation complete; 20260728120000 hardens this table when present. | Should never be directly client-readable. | Yellow |
| `public.au_admin_sessions` | Session IDs and lockout state, no provider key | Legacy/admin auth flows | Migration hardens if table exists. | Browser no longer stores returned custom admin token. | Yellow |
| `public.admin_access_logs` | IP, attempt count, lockout timestamp | `src/app/api/admin/auth/route.ts` | Explicit select only; server-side admin client. | Not browser raw credential data. | Green |
| `public.au_config` | Billing/config fields and `alert_config`, no raw provider key intended | `src/app/api/admin/handler/route.ts`, `rag-worker/src/worker.ts`, background config route | Admin handler now uses explicit DTO. Existing historical policy may allow public reads; not treated as secret table unless secret data is inserted. | Could leak if secrets are mis-stored there. | Yellow |

RLS alone is not considered sufficient for credential tables. The implemented controls are server-only access, explicit column selection, masked DTOs, no raw key echo on create/update/delete, audit metadata, app-layer encrypted storage for new provider-key writes, and static tests. Legacy plaintext rows remain Yellow until re-entered or rotated through the encrypted path.

## API Routes And Functions

| Route/function | Reads credentials | Returns credentials | Status |
|---|---:|---:|---|
| `src/app/api/admin/handler/route.ts` | Yes, server-only provider key create/update and registry metadata | No raw values; masked DTO only | Green |
| `src/lib/server/ai-routing.ts` | Yes, server-only provider key use | No browser response path | Yellow |
| `src/app/api/admin/auth/route.ts` | Uses Supabase anon key server-side for Edge proxy | Sanitizes upstream token/secret fields | Green |
| `src/app/api/au/vps-ticket/route.ts` | Uses `VPS_SHARED_SECRET` server-side | Returns short-lived signed VPS ticket by design; no raw shared secret | Yellow |
| `vps-ai-gateway/src/index.ts` | Uses VPS shared secret, Supabase server key, Qdrant key | No secret in health/errors/logs | Yellow until Oracle live logs verified |
| `vps-ai-gateway/src/chat-handler.ts` | Uses provider keys from env | No provider error body returned | Green |
| `vps-ai-gateway/src/generation-handler.ts` | Uses provider keys from env | No provider error body returned | Green |
| `src/lib/server/paystack.ts` | Uses Paystack secret env | No raw key returned | Green |
| `src/lib/payments/flutterwave.ts` | Uses Flutterwave secret env | No raw key returned | Green |
| `src/app/api/webhooks/*` | Uses webhook secrets/env verification | No raw secret returned | Green |
| `src/app/api/background/config/route.ts` | Uses service-role env to read visual config | Returns normalized visual config only | Yellow |

## Admin Credential Protection

Current behavior:

- Admin browser never receives raw provider key values from the model registry.
- Provider-key list returns configured status, `key_last4`, `key_fingerprint`, provider type, service, model allowlist, timestamps, and non-secret metadata.
- Create/update accepts a new secret but does not echo it back.
- New provider-key create/update encrypts the secret server-side, stores masked metadata, nulls legacy `key_value`, and does not echo the value back.
- Revoke clears server-side plaintext, encrypted value, encryption metadata/reference fields, marks inactive, and records `revoked_at`.
- Legacy `conex_admin_token` localStorage/header usage was removed; old stored values are only deleted.
- Admin auth proxy strips token/secret/key/credential fields from upstream payloads.
- Admin access-log lookup no longer uses `select('*')`.

Remaining gaps:

- Existing legacy provider-key rows may still contain plaintext `key_value` until an owner/admin re-enters or rotates them through the encrypted path.
- No admin re-auth UX beyond existing Conex/Supabase admin checks was added in this pass.
- Provider key `last_used_at` exists, but full use-audit on every provider request is not implemented yet.
- Direct live policy catalog verification and live provider-use tests must still be completed after deployment.

Provider-key encrypted storage plan:

1. Set `PROVIDER_KEY_ENCRYPTION_SECRET` in server-only runtime secret storage for the Next.js/admin server.
2. Confirm `supabase/migrations/20260729120000_provider_key_encryption_columns.sql` remains applied before using the new admin provider-key write path; the owner-confirmed final dry run reports the remote database is up to date.
3. Re-enter or rotate existing database-stored provider keys through the admin UI/API so they are stored in `encrypted_key_value` and legacy `key_value` is nulled.
4. Keep `key_last4`, `key_fingerprint`, rotation metadata, and audit logs for UI/status.
5. After all legacy rows are rotated and live provider calls pass, remove plaintext fallback in a later migration-safe task.

## API Key Flow Diagram

```mermaid
flowchart LR
  subgraph Browser["Browser boundary"]
    AdminUI["Admin UI"]
    App["App/PWA"]
  end

  subgraph Server["Server-only boundary"]
    AdminAPI["Next.js admin API"]
    Validate["Admin validation + explicit allowlist"]
    Router["Provider router"]
    TicketAPI["/api/au/vps-ticket"]
  end

  subgraph DB["Database boundary"]
    CredentialTable["Credential table / metadata"]
    Audit["Key audit logs"]
  end

  subgraph VPS["VPS boundary"]
    Gateway["VPS AI gateway"]
  end

  subgraph Provider["Provider boundary"]
    AI["AI provider"]
  end

  AdminUI -->|"new secret on create/update only"| AdminAPI
  AdminAPI --> Validate
  Validate -->|"encrypt server-side"| CredentialTable
  Validate -->|"masked DTO"| AdminUI
  Validate --> Audit
  Router -->|"server-side raw key use"| CredentialTable
  Router --> AI
  App --> TicketAPI
  TicketAPI -->|"short-lived ticket"| App
  App -->|"ticket Authorization"| Gateway
  Gateway --> AI

  CredentialTable -. forbidden raw key .-> AdminUI
  CredentialTable -. forbidden raw key .-> App
  Audit -. forbidden raw key .-> AdminUI
  App -. forbidden raw key storage .-> App
```

## Exposure Incident Review

Confirmed exposure found: yes.

| Location type | File paths | Tracked by git | Action | Rotation |
|---|---|---:|---|---|
| Tracked backend diagnostic scripts | `backend/check_env.cjs`, `backend/check_env.ts`, `backend/debug_stuck.cjs`, `backend/requeue_jobs.cjs`, `backend/requeue_jobs.ts`, `backend/verify_pipeline.ts`, `backend/verify_trigger.ps1` | Yes | Replaced with env-only placeholders. | Owner reports rotation complete; live smoke tests pending. |
| Tracked historical admin credential migration | `backend/supabase/migrations/20260129000001_admin_system.sql` | Yes | Replaced hardcoded seed values with placeholders. | Required for admin challenge/access credentials. |
| Tracked historical provider-key migration | `backend/supabase/migrations/20260202000001_cleanup_and_sync_keys.sql` | Yes | Removed provider key seeding and replaced with no-op-safe migration note. | Owner reports rotation complete; live provider smoke tests pending. |
| Tracked Supabase temp metadata | `supabase/.temp/*` | Was tracked | Removed from git index; already gitignored. | No key rotation based on temp paths alone. |
| Generated migration helper scripts | `scripts/apply_migration_temp.ts`, `scripts/apply_migration_via_handler.ts` | Yes | Deleted to enforce Supabase CLI-only migration workflow. | Not required from these files alone; they used env names, not raw values. |
| Browser build artifact | `.next/static/chunks/*` | No | JWT-shaped Supabase key decoded locally as `role: anon`; no raw value printed. | No rotation if live value is truly anon/publishable; rotate immediately if service-role was ever used in `NEXT_PUBLIC_SUPABASE_ANON_KEY`. |
| Stale generated documentation | `labeled_understanding.md` | Yes | Replaced unsafe public OpenRouter key guidance with server-only `OPENROUTER_API_KEY`. | No rotation from this file alone; it contained a name, not a value. |

Raw value printed in this report: no.

External API validation with exposed keys: not performed.

Bounded git-history review: high-confidence token-shaped values were found in the known exposure files' history using fingerprint-only output. The owner reports rotation is now complete for the affected credentials. Historical admin challenge/access seed values were also removed from the tracked migration; live systems must still confirm no legacy credential remains active.

## Runtime Secret Ownership Map

| Secret name | Stored in env/table/provider | Used by component | Browser-visible | Server-only | Rotatable | Current risk | Required action |
|---|---|---|---:|---:|---:|---|---|
| `VPS_SHARED_SECRET` | Env | Next.js ticket route + Oracle VPS gateway | No raw value | Yes | Yes | Yellow | Ensure same value on both sides; rotate if exposed. |
| `SUPABASE_SERVICE_ROLE_KEY` | Env | Next.js admin APIs, RAG worker, optional VPS server reads | No | Yes | Yes | Yellow | Owner reports rotation complete; verify post-rotation live services and logs. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Env/public config | Browser Supabase client | Yes | No | Yes | Green | Owner reports browser now uses the corrected publishable key; keep it anon/publishable only. |
| `QDRANT_API_KEY` | Env | VPS gateway, RAG worker, retention tooling | No | Yes | Yes | Green | Keep off frontend and logs. |
| `OPENROUTER_API_KEY` | Env or `au_api_keys` | Provider router/gateway | No | Yes | Yes | Yellow | Owner reports rotation complete; verify provider calls and re-enter database rows through encrypted storage. |
| `OPENAI_API_KEY` | Env | Provider router/gateway | No | Yes | Yes | Green | Keep server-only. |
| `ANTHROPIC_API_KEY` | Env | Provider router/gateway | No | Yes | Yes | Green | Keep server-only. |
| `PAYSTACK_SECRET_KEY` / `PAYSTACK_SECRET` | Env | Billing server routes | No | Yes | Yes | Green | Keep server-only. |
| `PAYSTACK_PUBLIC_KEY` | Env/public config if used | Browser checkout | Yes | No | Yes | Green | Public key only. |
| `FLUTTERWAVE_SECRET_KEY` | Env | Flutterwave server helper/webhook | No | Yes | Yes | Green | Keep server-only. |
| `FLUTTERWAVE_PUBLIC_KEY` | Env/public config if used | Browser checkout | Yes | No | Yes | Green | Public key only. |
| `FLUTTERWAVE_WEBHOOK_SECRET_HASH` | Env | Webhook verification | No | Yes | Yes | Green | Keep server-only. |
| Supabase access token | Supabase auth session | Browser/API Authorization | Yes | No | Yes | Green | Do not cache in offline queue. |
| Supabase refresh token | Supabase auth session | Browser Supabase client | Yes | No | Yes | Yellow | Verify live session cleanup. |
| Signed VPS ticket | Generated per request | Browser to VPS gateway | Yes, short-lived | No | N/A | Yellow | Do not persist or log; keep route-bound and 5-minute TTL. |

## Verification Notes

- High-confidence tracked secret patterns were scanned path-only.
- Client build JWT-shaped hit was decoded without printing and confirmed as Supabase `role: anon`.
- Public/service-worker output was checked for credential plumbing patterns.
- Admin handler static checks assert no `select('*')`, no raw provider-key response, masked DTOs, and audit metadata.
- Offline queue static tests assert Authorization/cookie/key/token headers are stripped and fresh auth is resolved at replay time.

## Provider-Key Encryption Implementation Status

Current storage model:

- Environment provider keys remain server-only env values.
- Database provider keys now have nullable encrypted/provider-reference columns; user-confirmed Supabase CLI verification shows the provider-key encryption migration is applied and the remote database is up to date.
- New admin create/update stores `encrypted_key_value`, `key_encryption_version`, `key_encrypted_at`, `key_last4`, `key_fingerprint`, and rotation metadata.
- New admin create/update sets legacy `key_value` to null.
- Server AI routing decrypts encrypted rows only in server code immediately before provider use.
- Legacy plaintext `key_value` fallback remains for existing rows until owners rotate/re-enter those rows.

Required server-only env var names:

- `PROVIDER_KEY_ENCRYPTION_SECRET`

Do not define this as `NEXT_PUBLIC_*`.

## Final Addendum Status

API key pipeline partially safe; post-rotation live checks and legacy provider-key re-entry are still required before Green.
