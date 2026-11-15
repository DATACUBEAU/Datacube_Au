# DataCube AU backend data model v2

Status: audit-backed target design. This document does not apply schema changes or delete data.

## Product rules

- Global Chat is general-purpose chat. It does not retrieve from uploaded documents.
- Global Chat supports both on-device AU Local models and server-routed AU Cloud models.
- A conversation keeps its thread context when the user returns. Cloud conversations sync through Supabase; local-only conversations remain on-device unless the user explicitly enables sync.
- Document intelligence is a separate on-device feature. No server-side document parsing, chunking, embeddings, vector search, document storage, or document retention is part of this target.
- Provider credentials stay server-side. Flutter never receives OpenRouter or other provider API keys.
- Local inference does not consume cloud credits or incur provider cost. Cloud inference is metered and charged against the user's server-authoritative allowance.
- Supabase remains the SaaS control plane: Auth, profiles, subscriptions, entitlements, admin, cloud model routing, usage accounting, and synced cloud chat.

## Global Chat execution path

1. Flutter loads the thread and model preference.
2. The user chooses AU Local or AU Cloud (or a user-configured automatic policy).
3. AU Local runs on-device and reads only the current conversation context. It makes no provider request and creates no cloud-credit reservation.
4. AU Cloud sends the minimum conversation turns needed to preserve context to the authenticated model-router Edge Function. It does not attach document content.
5. The server resolves entitlement, allowed model, provider, price schedule, budget, and rate limits. It reserves usage atomically before contacting the provider.
6. The server calls the provider using a server-held secret, records actual tokens/cost, commits the reservation, and returns the answer.
7. Cloud thread/messages are persisted in Supabase. Local-only thread/messages are stored on-device. If sync is enabled, sync is an explicit separate operation.

## Canonical table direction

| Domain | Canonical target | Existing objects | Direction |
|---|---|---|---|
| Provider credentials | `au_api_keys` during transition; secret-manager references as target | `au_api_keys`, `au_provider_key_audit_logs` | Keep one credential registry, but stop storing plaintext key values. Move secret material to Supabase Vault or a managed secret store; keep only reference, fingerprint, last-four, provider, scope, status and rotation metadata in the table. |
| Model catalogue | `au_models_registry` | `au_models_registry`, `au_pro_models_registry` | Merge free/pro rows and metadata into one registry with tier, capabilities, context window, provider, pricing, active status and local/cloud capability. Retire the separate Pro registry only after code and data cutover. |
| Model routing | Registry policy initially | `au_model_routing` | It currently has no rows and the inspected resolver uses the two registries instead. Fold priority/tier/provider routing into the canonical registry or a single routing policy table; do not keep two competing sources. |
| Model cost/telemetry | `au_model_usage` during transition | `au_model_usage`, `au_model_usage_stats` | Preserve detailed model execution records, add strict idempotency and price-version references. Stats are a rebuildable aggregate, not a source of truth. |
| Quota ledger | `au_usage_events` | `au_usage_events`, `usage_counters`, `usage_totals`, `au_usage_daily`, `au_weekly_feature_usage`, `au_usage_metric_definitions` | Make append-only usage events the ledger. Keep daily/total counters only as transactionally maintained projections. `au_usage_daily` and weekly tables are retirement candidates after reference checks; `usage_counters` and `usage_totals` are currently used by reservation logic. |
| Atomic reservations | `ai_usage_reservations` | `ai_usage_reservations` and reserve/begin/commit/release RPCs | Keep and make this the mandatory gateway path. It currently has zero rows and inspected model-call logging does not call it. Replace old non-atomic check-then-increment paths. |
| Plans | `billing_plans` | `billing_plans`, `au_billing_plans` | Prefer the Paystack-oriented `billing_plans` as the canonical plan catalogue after confirming all active checkout code. `au_billing_plans` is a retirement candidate. |
| Subscriptions | `billing_subscriptions` | `billing_subscriptions`, `au_subscriptions` | Current entitlement resolver reads `billing_subscriptions`; `au_subscriptions` has zero rows and is a retirement candidate after code-reference verification. |
| Payments | `billing_transactions` | `billing_transactions`, `au_payments`, `au_manual_payments` | Prefer `billing_transactions` for gateway transactions. Preserve manual-review workflows and the dependency on `au_admin_manual_review_queue` before retiring `au_payments`. Decide whether manual payments remain a separate review domain or become transaction types. |
| Webhook inbox | `billing_webhook_events` | `billing_webhook_events`, `au_billing_events` | Prefer a single durable webhook inbox with provider + provider event ID unique constraint, payload hash, signature verification result, processing status and idempotent handler. Both current tables need dependency verification before consolidation. |
| Entitlements | `entitlement_grants` + explicit override table | `entitlement_grants`, `au_user_entitlements`, profile tier fields, `entitlement_audit` | Grants should be the authoritative subscription/promo/admin-grant ledger. Move admin overrides into a dedicated audited override table. Profiles must not be the paid-plan source of truth. Retire mirrored entitlement state after resolver cutover. |
| Chat | `au_sessions` + `au_messages` | `au_sessions`, `au_messages` | Preserve. These are not document-ingestion tables. Add/standardize thread ID, execution mode, selected model, sync state and idempotent message IDs as needed. Never delete chats when a document is deleted. |

## Audit facts observed in the connected database

- `au_api_keys`: 2 active OpenRouter rows; both currently have legacy plaintext key values. Neither uses the encrypted-value or secret-reference columns. Secret values were not read or exposed.
- `au_models_registry`: 2 active free OpenRouter models.
- `au_pro_models_registry`: 2 active paid OpenRouter models. The tables duplicate the model-catalogue concern.
- `au_model_routing`: 0 rows.
- `au_model_usage`: 26 rows. 22 rows have no recorded `cost_usd`; the available sample totals are historical and must not be treated as complete spend reporting.
- `ai_usage_reservations`, `au_usage_events`, `au_usage_daily`, `au_model_usage_stats`, `au_subscriptions`, `au_billing_events`: 0 rows at audit time.
- `usage_counters`: 24 rows; `usage_totals`: 4 rows.
- `billing_plans` and `au_billing_plans`: 2 rows each.
- `billing_subscriptions`: 1 row; `au_subscriptions`: 0.
- `billing_transactions`: 9 rows; `au_payments`: 2.
- `billing_webhook_events`: 0; `au_billing_events`: 0.
- The current entitlement RPC reads `billing_subscriptions` and `entitlement_grants`, but also consults profile tier and mirrored entitlement state. The effective-limits RPC still contains legacy fallbacks and old document-related limits.
- The current model resolver selects from `au_models_registry` and `au_pro_models_registry`; it does not use the empty `au_model_routing` table.
- The inspected model usage logger inserts into `au_model_usage`; the atomic reservation functions are not wired into that path. The reservation commit function still labels events as originating from `vps-ai-gateway`, which must be replaced during the gateway refactor.
- `get_rotated_api_key(text)` was callable by anon/authenticated roles before this audit; execute permission has now been restricted to `service_role`. A matching forward migration was committed separately.
- Legacy RLS policies on `au_billing_events`, `au_payments`, and `au_manual_payments` used `TO public` with unconditional access despite being labelled service-role policies. A forward migration now scopes those policies to `service_role`. It has not been applied to the live database.

## Atomic cloud-usage protocol

Every cloud inference request must use one server-side transaction protocol:

1. Authenticate user and resolve effective entitlement/plan.
2. Validate feature, model allowlist, request size, rate limits and budget.
3. Create an idempotent reservation keyed by user + feature + client request ID. Lock the relevant per-user counters and reject if the reservation would exceed the allowance.
4. Mark the reservation as provider-started exactly once.
5. Call the provider with a bounded timeout and bounded retry policy.
6. On success, record actual input/output tokens, provider-reported cost, price schedule version, model/provider, latency and request IDs. Commit once and adjust reserved counters to actual usage.
7. On failure before provider execution, release the reservation. On ambiguous provider timeout, reconcile by provider request ID before retrying to avoid double billing.
8. Emit one immutable usage-ledger event. Unique idempotency constraints prevent duplicate charges. Counters are projections maintained in the same database transaction as the ledger/reservation transition.

The existing reservation RPCs provide a useful base, but the live model-call path must be rewired and the commit/release semantics tested for concurrency, retries, timeouts and reconciliation before this is considered atomic in production.

## Cost controls

- Prefer local inference for eligible requests when the user selects it; local requests consume no cloud credits.
- Route by task complexity and user tier, not a single fixed model.
- Maintain versioned provider/model input and output prices. Estimate before reservation; reconcile to provider-reported actual cost after response.
- Set max output tokens, context-window budgets, request-size limits and per-user concurrency limits.
- Trim conversation context to the smallest useful window; summarize older turns with user-visible continuity.
- Use provider prompt caching where supported and verify the provider's actual cached-token pricing.
- Cache only safe, non-user-specific outputs. Never share one user's private conversation cache with another user.
- Apply bounded retries only for retryable failures; do not retry authentication, invalid-request or quota errors.
- Add circuit breakers and provider fallback without silently changing the user's selected local/cloud privacy mode.
- Track cost per provider, model, feature, plan, user cohort and day; alert on cost spikes and anomalous token usage.

## Scale and operations

- Keep hot transactional tables narrow and indexed by user/time/idempotency keys.
- Use unique constraints for request IDs, webhook event IDs and reservation keys.
- Use atomic SQL functions for counters and state transitions; do not use application-side read-then-write counters.
- Partition append-only usage and message tables by time only when measured volume justifies it; do not partition prematurely.
- Retain raw webhook payloads and operational logs under explicit retention policies; redact secrets and sensitive prompt content.
- Use background jobs for rollups, reconciliation, retention and analytics, not for the critical reservation/commit transaction.
- Add load tests for concurrent requests by one user, many users, hot-key contention, provider failures and webhook replay.
- Monitor p50/p95/p99 latency, DB pool saturation, lock waits, reservation age, provider errors, cost/request and cost/user.

## Safe migration order

1. Snapshot schema/data and inventory all code references, RPCs, triggers, views, policies and foreign keys.
2. Apply the RLS policy correction migration and verify anon/authenticated cannot write billing records.
3. Move provider key material to Vault/managed secrets, rotate the keys, then remove plaintext columns only after code cutover.
4. Merge model registry data into one schema and update model resolution; dual-read/compare before retiring the Pro table.
5. Wire all cloud model calls (Global Chat, predictions, study features) through the reservation/commit/release protocol.
6. Consolidate entitlement and billing reads onto canonical tables; backfill with reconciliation and retain compatibility views during rollout.
7. Move all model and quota telemetry to the canonical event model and rebuild projections.
8. Retire duplicate tables only after zero code references, zero external API clients, validated row reconciliation, and a rollback window.
9. Load-test and verify with production-like concurrency before claiming million-user readiness.

## Do not delete yet

No billing, usage, model, entitlement or chat table should be dropped based only on matching names or low row counts. In particular, preserve `au_messages`, `au_sessions`, `billing_transactions`, `billing_subscriptions`, `entitlement_grants`, `usage_counters`, `usage_totals` and `ai_usage_reservations` until the migration and dependency checks are complete.
