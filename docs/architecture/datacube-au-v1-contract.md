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
