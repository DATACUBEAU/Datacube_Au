# DataCube AU backend data model v2

Status: audit-backed target design. This document does not apply schema changes or delete data.

## Product rules

- Global Chat is general-purpose chat. It does not retrieve from uploaded documents.
- Global Chat supports both on-device AU Local models and server-routed AU Cloud models.
- **All Global Chat history stays on the user's device**, for both AU Local and AU Cloud. Supabase must not store transcripts, prompts, assistant answers, thread histories, conversation summaries, or chat memory. There is no automatic or optional chat-history sync.
- Document intelligence is a separate on-device feature. No server-side document parsing, chunking, embeddings, vector search, document storage, or document retention is part of this target.
- Provider credentials stay server-side. Flutter never receives OpenRouter or other provider API keys.
- Local inference does not consume cloud credits or incur provider cost. AU Cloud sends only the minimum relevant recent turns to the provider transiently for the current inference; DataCube does not persist that context or the returned answer. Cloud usage and cost metadata may be recorded without prompt/answer content.
- Supabase remains the SaaS control plane: Auth, profiles, subscriptions, entitlements, admin, cloud model routing, usage accounting, billing records, and operational/security metadata. It is not a chat-history store.

## Global Chat execution path

1. Flutter loads the user's thread and selected model from the device's private local database.
2. The user explicitly chooses AU Local or AU Cloud. The choice is shown before a cloud request is sent.
3. AU Local reads the thread from device storage and runs the model on-device. It makes no cloud/provider request and creates no cloud-credit reservation.
4. AU Cloud sends only the minimum recent turns needed for the current answer to the authenticated model-router Edge Function. It never attaches document content; Global Chat is not document RAG.
5. The server validates an explicit cloud execution mode, resolves entitlement/model/provider/pricing/limits, and reserves cloud usage atomically before provider execution.
6. The server sends the selected context to the provider for this request, receives the answer, records metadata only (tokens, cost, provider/model, latency, request ID), commits actual usage, and returns the answer.
7. Flutter saves user and assistant messages locally. Supabase receives no prompt, answer, message body, conversation transcript, summary, thread/session ID, or response cache. Chat-history sync is not supported.

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
| Chat history | Device-local database | Legacy `au_sessions`, `au_messages`, `au_request_idempotency.response_json` | Device storage is the only source of truth for Global Chat history. Stop all server transcript/message/answer-cache writes. Existing server-side chat records require an explicit export-to-device and retention/purge plan; do not silently drop or rewrite them. Document deletion remains separate from chat-history deletion. |

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
- The inspected model usage logger inserts into `au_model_usage`; an additive actual-usage commit RPC is now installed, but inference paths still require wiring and load testing before quota enforcement is fully atomic. Reservation expiry now excludes provider-started requests and disputed releases keep quota held for reconciliation.
- `get_rotated_api_key(text)` was callable by anon/authenticated roles before this audit; execute permission has now been restricted to `service_role`.
- Legacy RLS policies on `au_billing_events`, `au_payments`, `au_manual_payments`, and `au_model_routing` used or relied on broad policy scope. The write/manage policies are now explicitly scoped to `service_role` in the live database; user-owned payment/manual-payment access and the model metadata read policy remain in place.

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
5. Remove Global Chat response-cache and transcript persistence; migrate existing server-side chat records to users' devices only through an explicit supported export path, then apply a separately approved purge. Wire all cloud model calls (Global Chat, predictions, study features) through the reservation/commit/release protocol.
6. Consolidate entitlement and billing reads onto canonical tables; backfill with reconciliation and retain compatibility views during rollout.
7. Move all model and quota telemetry to the canonical event model and rebuild projections.
8. Retire duplicate tables only after zero code references, zero external API clients, validated row reconciliation, and a rollback window.
9. Load-test and verify with production-like concurrency before claiming million-user readiness.

## Do not delete yet

No billing, usage, model, entitlement or chat table should be dropped based only on matching names or low row counts. In particular, preserve `au_messages`, `au_sessions`, `billing_transactions`, `billing_subscriptions`, `entitlement_grants`, `usage_counters`, `usage_totals` and `ai_usage_reservations` until the migration and dependency checks are complete.
