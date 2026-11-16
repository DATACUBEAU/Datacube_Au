# DataCube AU V1 architecture contract

Status: agreed target contract; implementation and production cutover are gated by P0/P1 verification.

## Product boundary

- Flutter is the V1 customer app.
- Supabase remains the SaaS control plane: Auth, profiles, subscriptions, Paystack, entitlements, admin, support, model catalogue/routing, cloud usage, audit/security and stateless AU Cloud inference.
- Next.js public website and admin portal remain available during mobile migration.
- Documents, parsed text, OCR output, chunks, embeddings, vector indexes, document insights and chat history remain on the user's device.
- AU Local performs local retrieval and local inference where supported. Local inference never consumes cloud credits.
- AU Cloud receives only the user's question and explicitly consented, locally retrieved context passages. It must not retrieve documents from Supabase or persist prompt, context, completion or chat history by default.
- Cloud execution records operational metadata only: provider/model, tokens/cost, latency, status, request/idempotency IDs and necessary abuse/security metadata.
- Provider credentials remain server-side.

## V1 execution flow

```text
Flutter -> Auth -> AU Home -> AU Documents -> local import/parser/OCR
       -> local chunking/embeddings/index -> local retrieval -> AU Chat
       -> inference choice
            | AU Local: on-device model -> answer -> local history
            | AU Cloud: consented question/context -> Supabase gateway
                       -> auth/entitlement/limits/reservation
                       -> provider -> settle usage -> answer
                       -> local history
```

## Required release gates

1. P0 baseline: schema/migration/policy/storage/function inventory; map dependencies; backup/disposition plan; protect billing/auth/admin; verify document object ownership; fix immediate exposure without deleting data.
2. P1 contracts: Flutter modules, local persistence, import/parser/retrieval, model lifecycle, Cloud request/response and consent, idempotent usage reservation/settlement, offline/fallback behavior.
3. P2 vertical slice: sign in, import one supported document, ask offline, grounded answer with citations, reopen local chat after restart; no document/chat content reaches Supabase.
4. P3 stateless cloud: one supported endpoint; auth/entitlement/credit enforcement; bounded payload/timeouts/cost; no content persistence/logging; idempotency/retry/failure tests.
5. P4 control plane: trusted admin authorization, RLS/RPC hardening, Paystack and entitlement authority, least privilege.
6. P5 retire server document/chat infrastructure only after Flutter parity and dependency/ownership checks.
7. P6 mobile QA, staged rollout, telemetry without content, rollback/support plan.

## Non-negotiable change controls

- No destructive production DB/storage change without reviewed migration, explicit approval, backup/disposition plan and post-change verification.
- Each implementation slice uses a branch, focused PR, tests and preview validation.
- Do not merge legacy worker changes automatically; evaluate against the local-first target.
- Preserve accounts, payments, subscriptions, entitlements, admin, support, model routing and security/audit records.
- Never grant admin from editable user metadata.
- No direct-to-main writes or automatic merges.


## Usage, subscriptions and future reward-system contract

These are required integration boundaries for later implementation; they do not authorize enabling ads or changing billing in the mobile-foundation work.

- Preserve the existing Paystack Pro subscription intervals and canonical plan keys: `pro_weekly` and `pro_monthly`. Do not collapse weekly and monthly into one plan, rename either key, change their Paystack plan codes, or replace their existing billing/renewal behavior.
- Existing subscription state and effective entitlements remain the authority for paid access. Future usage caps may differ by plan, but neither plan grants unlimited usage.
- Future rewarded access is a separate, server-verified feature-unlock ledger. Reward unlocks must never mint, top up, or extend cloud credits/allowances and must not mutate subscription status.
- Reward verification, idempotency, replay prevention, per-user caps and unlock expiry are server-authoritative. A client-side ad-completion callback alone must never grant access.
- Time-window limits use server-authoritative timestamps and deterministic UTC storage. User-facing reset times are rendered using the account's validated IANA time-zone preference, with a safe UTC fallback; daylight-saving transitions must not change quota correctness.
- Usage limits are defined per feature and plan, with explicit reset policy/interval (including hourly, daily, weekly or monthly where configured). All limits fail closed when authoritative usage state cannot be checked.
- Local inference and local voice sessions do not consume cloud allowances. Cloud voice remains disabled by default and is independently controllable from the admin portal. Local voice, local Smart Mode and local predictions may later support reward-based access without affecting cloud accounting.
- Cloud fallback may use a compatible local model when cloud is unavailable or a cloud cap is reached; it must never retry through cloud in a way that bypasses the cap. The app must clearly identify the active execution mode.
- Admin controls must independently govern cloud model availability, cloud voice availability, feature availability and relevant limits. Client UI flags are not authorization; server-side enforcement remains mandatory.
