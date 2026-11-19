# DataCube AU V1 architecture contract

Status: agreed target contract; implementation and production cutover are gated by P0/P1 verification.

## Product boundary

- The active V1 customer mobile app is the native Android application in `apps/android`, built with Kotlin and Jetpack Compose.
- The Flutter scaffold in `apps/mobile` is a retained migration/reference project only. It is not the active customer-app implementation; new mobile features and fixes belong in `apps/android`.
- Supabase remains the SaaS control plane: Auth, profiles, subscriptions, Paystack, entitlements, admin, support, model catalogue/routing, cloud usage, audit/security and stateless AU Cloud inference.
- The Next.js customer-facing website exposes the login and subscription-checkout journeys. The Conex admin portal remains a separate privileged surface.
- Documents, parsed text, OCR output, chunks, embeddings, vector indexes, document insights and chat history remain on the user's device.
- AU Local performs local retrieval and local inference where supported. Local inference never consumes cloud credits.
- AU Cloud receives only the user's question and explicitly consented, locally retrieved context passages. It must not retrieve documents from Supabase or persist prompt, context, completion or chat history by default.
- Cloud execution records operational metadata only: provider/model, tokens/cost, latency, status, request/idempotency IDs and necessary abuse/security metadata.
- Provider credentials remain server-side.

## V1 execution flow

```text
Kotlin Android (Jetpack Compose) -> Auth -> AU Home -> AU Documents
       -> local import / Room metadata / WorkManager processing
       -> local parsing, chunking, embeddings and retrieval as capabilities land
       -> AU Chat -> inference choice
            | AU Local: supported on-device model -> answer -> local history
            | AU Cloud: consented question/context -> Supabase gateway
                       -> auth/entitlement/limits/reservation
                       -> provider -> settle usage -> answer
                       -> local history
```

## Required release gates

1. P0 baseline: schema/migration/policy/storage/function inventory; map dependencies; backup/disposition plan; protect billing/auth/admin; verify document object ownership; fix immediate exposure without deleting data.
2. P1 contracts: Kotlin/Compose modules, Room persistence, Storage Access Framework import, WorkManager lifecycle, parser/retrieval pipeline, model lifecycle, Cloud request/response and consent, idempotent usage reservation/settlement, offline/fallback behavior.
3. P2 vertical slice: sign in, import one supported document, complete the available local processing path, ask a grounded question where a supported local model is available, and reopen local state after restart; no document/chat content reaches Supabase.
4. P3 stateless cloud: one supported endpoint; auth/entitlement/credit enforcement; bounded payload/timeouts/cost; no content persistence/logging; idempotency/retry/failure tests.
5. P4 control plane: trusted admin authorization, RLS/RPC hardening, Paystack and entitlement authority, least privilege.
6. P5 retire server document/chat infrastructure only after native Kotlin app parity and dependency/ownership checks.
7. P6 Android device QA, staged rollout, telemetry without content, rollback/support plan.

## Non-negotiable change controls

- No destructive production DB/storage change without reviewed migration, explicit approval, backup/disposition plan and post-change verification.
- Each implementation slice uses a branch, focused PR, tests and preview validation.
- Do not merge legacy worker changes automatically; evaluate against the local-first target.
- Preserve accounts, payments, subscriptions, entitlements, admin, support, model routing and security/audit records.
- Never grant admin from editable user metadata.
- No direct-to-main writes or automatic merges.
