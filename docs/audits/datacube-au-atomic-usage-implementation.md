# DataCube AU Atomic Usage Accounting Implementation

Last updated: 2026-07-28

Status model:

- Green = implemented and verified
- Yellow = implemented but needs live Oracle/provider verification
- Red = unsafe or not implemented
- Grey = cannot verify from repo alone

## Current Usage Flow Before Fix

Before this sprint, `/api/au/vps-ticket` authenticated the user, checked entitlement/limits in application code, minted a short-lived VPS ticket, and attempted to pre-increment usage with `trackUsageEvent`. That meant usage could be charged before the VPS provider request succeeded, and a failure in usage tracking did not block ticket issuance.

The VPS gateway verified route/feature-bound tickets and generated AI responses, but it had no durable reservation metadata and no commit/release step tied to the provider result.

## Weak Points Fixed

| Weak point | Previous risk | New status |
|---|---|---|
| Limit races | Concurrent ticket requests could pass app-side checks before usage was written. | Green |
| Failed generation overcharge | Ticket minting could count usage before provider success. | Green |
| Retry double-charge | Duplicate request attempts could create multiple usage events. | Green |
| Provider fallback accounting | A user action had no single durable accounting object. | Green |
| Ticket replay/provider cost leak | A replayed ticket could start a second provider attempt. | Green in code; Yellow until live Oracle streaming retry validation |
| Cross-user commit/release | Browser/user payload could not be trusted for accounting mutation. | Green |

Ticket replay is marked Yellow for deployment readiness because the gateway now calls `begin_ai_usage_reservation` to reject any second provider start for the same reserved action until it is committed, released, disputed, or expired, but live streaming reconnect behavior still needs manual validation after Oracle VPS deployment.

## New Target Flow

1. Client creates a per-action idempotency key.
2. Client requests `/api/au/vps-ticket` with `feature` and `idempotencyKey`.
3. Next.js authenticates the user and resolves entitlement/plan limits server-side.
4. Next.js calculates safe usage increments and limit checks without trusting browser `user_id`, feature, route, or plan.
5. Next.js calls `reserve_ai_usage` through the server-side Supabase admin client.
6. The RPC locks usage counter rows, checks daily counters against `usage_today` and lifetime counters against `usage_totals`, rejects over-limit reservations, and dedupes by `(user_id, feature_key, idempotency_key)`.
7. Next.js signs a VPS ticket only after reservation succeeds.
8. The signed ticket includes `reservation_id` and `idempotency_key`.
9. VPS verifies ticket claims and injects reservation metadata into internal headers.
10. Gateway calls `begin_ai_usage_reservation` immediately before provider generation to prevent duplicate in-flight attempts.
11. Gateway calls `commit_ai_usage` after successful provider generation.
12. Gateway calls `release_ai_usage` for validation failures, provider failures, and provider timeouts.
13. `expire_ai_usage_reservations` releases stale pending reservations.

## Tables And RPCs Changed

| Object | Type | Status | Purpose |
|---|---|---|---|
| `public.ai_usage_reservations` | Table | Green | Durable reserve/commit/release lifecycle for AI requests. |
| `idx_ai_usage_reservations_user_feature_idempotency` | Unique index | Green | Prevents duplicate reservations for the same user action. |
| `idx_ai_usage_reservations_user_status_expires` | Index | Green | Supports user/status lookup and cleanup. |
| `idx_ai_usage_reservations_status_expires` | Partial index | Green | Supports stale reservation expiry. |
| `reserve_ai_usage` | RPC | Green | Locks counters, checks limits, increments reserved counters, and returns an active reservation. |
| `begin_ai_usage_reservation` | RPC | Green | Marks provider execution start and rejects active duplicate in-flight attempts. |
| `commit_ai_usage` | RPC | Green | Idempotently commits successful generations and records an `au_usage_events` row without double-incrementing counters. |
| `release_ai_usage` | RPC | Green | Idempotently releases reserved counters on failed/aborted provider outcomes. |
| `expire_ai_usage_reservations` | RPC | Green | Batch cleanup for expired reserved rows. |
| `prompt_starters_per_day` | Usage metric definition | Green | Enables Prompt Starters to participate in atomic accounting. |

All mutation RPCs are service-role only. The reservation table has RLS enabled, no anon/authenticated table grants, and a service-role-only policy.

Implemented migrations:

- `supabase/migrations/20260728153000_atomic_usage_accounting.sql`: creates the reservation table, indexes, usage metric, service-role-only RPCs, grants, and RLS boundary.
- `supabase/migrations/20260728154500_atomic_usage_limit_scope_fix.sql`: updates `reserve_ai_usage` so daily feature/token/chat quotas check daily counters and total quotas check lifetime counters.
- `supabase/migrations/20260728160000_atomic_usage_replay_guard.sql`: updates `reserve_ai_usage` to reject idempotency-key reuse with a different request fingerprint and updates `begin_ai_usage_reservation` to reject any duplicate provider start for an active reservation.

## API Routes Changed

| Route | Status | Change |
|---|---|---|
| `src/app/api/au/vps-ticket/route.ts` | Green | Removed pre-commit usage tracking; now reserves usage before signing and includes reservation claims in the signed VPS ticket. |

The route still performs entitlement and user authentication first. It never trusts browser-supplied `user_id`, `feature_key`, `route`, or plan. The browser may provide an idempotency key, but uniqueness is scoped to the authenticated user and feature.

## Gateway Integration Points

| File | Status | Change |
|---|---|---|
| `vps-ai-gateway/src/auth.ts` | Green | VPS tickets must include reservation and idempotency claims. Missing claims fail closed. |
| `vps-ai-gateway/src/index.ts` | Green | Gateway requires `SUPABASE_SERVICE_ROLE_KEY`, forwards signed reservation metadata internally, and does not trust browser body fields for accounting. |
| `vps-ai-gateway/src/usage-accounting.ts` | Green | Adds begin/commit/release helpers with sanitized error handling. |
| `vps-ai-gateway/src/chat-handler.ts` | Green | AU Chat, Global Chat, and legacy chat begin before provider generation, commit on success, and release/dispute on failure. |
| `vps-ai-gateway/src/generation-handler.ts` | Green | Knowledge Hub, Practice Exam, Exam Prediction, and Prompt Starters begin before provider generation, commit on success, and release on missing content/provider failure. |

## Client Idempotency

| Client path | Status | Change |
|---|---|---|
| `src/lib/api/chat.ts` | Green | Chat and Prompt Starters send a per-action idempotency key to ticket and gateway requests. |
| `src/lib/api/exams.ts` | Green | Practice Exam and Exam Prediction send a per-action idempotency key to ticket and gateway requests. |
| `src/hooks/use-store.ts` | Green | Store-backed Knowledge Hub and Exam Prediction flows send stable per-action idempotency keys. |
| `src/lib/api/ai-idempotency.ts` | Green | Shared client key generator; keys contain no secrets. |

## Cost-Control Policy

| Outcome | Policy |
|---|---|
| Provider success | Commit reservation exactly once. |
| Provider failure | Release reservation and return sanitized provider error. |
| Provider timeout | Release reservation. |
| Client abort before provider call | Release reservation. |
| Client abort after provider call started | Release when detected; mark ambiguous commit failures as disputed. |
| Streaming partial success | Commit after provider returns the generated answer before sending final done event. |
| Provider fallback | Count as one user action/reservation; gateway records the final selected provider/model. |
| Duplicate retry | Same `(user_id, feature_key, idempotency_key)` returns existing reservation; begin RPC rejects active duplicate in-flight attempts. |
| Expired reservation | Cleanup RPC releases held counters and marks `expired`. |
| Disputed reservation | Used when provider succeeded but commit/settlement failed; requires admin review/reconciliation. |

## Tests Added Or Run

| Check | Result |
|---|---|
| `npm run test:atomic-usage` | Passed. |
| `npm run typecheck` | Passed. |
| `npm run build` | Passed. |
| `cd vps-ai-gateway && npm run build` | Passed. |
| Focused VPS ticket security compile/run | Passed. |
| `npx supabase migration list` before push | Showed only `20260728153000` pending. |
| `npx supabase db push --dry-run` before push | Showed only `20260728153000_atomic_usage_accounting.sql`. |
| `npx supabase db push` | Executed successfully for `20260728153000_atomic_usage_accounting.sql`. |
| Follow-up `npx supabase migration list` before scope fix | Showed only `20260728154500` pending. |
| Follow-up `npx supabase db push --dry-run` before scope fix | Showed only `20260728154500_atomic_usage_limit_scope_fix.sql`. |
| Follow-up `npx supabase db push` | Executed successfully for `20260728154500_atomic_usage_limit_scope_fix.sql`; earlier retries failed before applying because of Supabase temporary login/network errors. |
| Replay-guard `npx supabase migration list` before push | Showed only `20260728160000` pending. |
| Replay-guard `npx supabase db push --dry-run` before push | Showed only `20260728160000_atomic_usage_replay_guard.sql`. |
| Replay-guard `npx supabase db push` | Executed successfully after a retry for temporary Supabase login-role errors. |
| `npx supabase migration list` after push | Showed `20260728153000`, `20260728154500`, and `20260728160000` applied locally and remotely. |
| Final `npx supabase db push --dry-run` | `Remote database is up to date.` |
| `npx supabase db lint --linked --schema public` | Remote lint completed; recognized `public.reserve_ai_usage`; unrelated legacy schema issues remain. |

## Remaining Risks

| Risk | Status | Action |
|---|---|---|
| Oracle VPS env/runtime not yet restarted with service-role key requirement | Yellow | Restart the gateway after deployment and run the post-hardening live checklist. |
| Live streaming reconnect behavior | Yellow | Verify a browser reconnect cannot start duplicate provider calls for the same action. |
| Expiry cleanup scheduling | Yellow | Wire `expire_ai_usage_reservations` into an existing cron/background worker. |
| Remote schema lint legacy errors | Yellow | Separate cleanup sprint for old functions referencing missing legacy tables/columns. |
| Exact provider token billing | Yellow | Current commit uses reserved/estimated units; add provider usage reconciliation when provider response metadata is consistently available. |
