# Supabase production hardening checkpoint — 2026-11-15

## Completed against the live project

Project ref: `dhmukdeljiwvvwjdcxgn`.

### Billing renewal RPC exposure
- Enabled RLS on `public.billing_renewal_attempts`.
- Revoked table privileges from `PUBLIC`, `anon`, and `authenticated`; retained `service_role`.
- Restricted `apply_billing_renewal_failure(...)` execution to `service_role`.
- Pinned its search path to `pg_catalog, public`.
- Verified: RLS enabled; anon/authenticated cannot SELECT or INSERT; service_role can SELECT; anon/authenticated cannot execute the function; service_role can execute it.
- The table had zero rows at the time of change. No billing records or subscription state were changed.

### Usage-counter mutation
- Restricted `increment_usage_counters(uuid,jsonb,date)` execution to `service_role`.
- Verified: anon/authenticated cannot execute; service_role can execute.
- Existing reservation/commit/release RPCs inspected are already service-role-only. Reservation/event tables are protected by service-role policies; user-facing usage counters/events expose own-row SELECT policies only.
- Live usage snapshot: 0 rows in `ai_usage_reservations`, 0 in `au_usage_events`, 26 in `au_model_usage`, 24 in `usage_counters`, 4 in `usage_totals`. Zero reservations/events means production end-to-end atomic settlement still needs a real authenticated cloud-inference test; it is not proven by schema inspection alone.

## Migration source-of-truth correction

- The root `supabase/` directory is used by the migration-chain workflow and contains the known local-first migration.
- The package scripts previously targeted `backend/`, whose migration files do not contain the latest live migration set.
- Updated Supabase CLI scripts to use the root project directory and set root `project_id` to the actual project ref.
- Kept pgvector installed in the legacy-retirement migration because retained schema objects still depend on vector columns.
- **Do not run `supabase db push` yet.** These live migration versions are recorded in Supabase but their SQL files are missing from both checked repository migration paths:
  - `20261115195306_fix_billing_service_role_rls`
  - `20261115195524_atomic_ai_usage_actual_commit`
  - `20261115195956_protect_inflight_ai_usage_reservations`
- Recover the exact applied SQL for those migrations from source-control history/deployment artifacts, or reconstruct them from verified live definitions with explicit provenance. Do not invent replacement history or use migration repair to hide the drift.

## Remaining priority gates

1. **Atomic usage:** trace each cloud inference route from reserve → provider-start → provider response → actual commit/release; test concurrent requests, duplicate idempotency keys, provider failure, timeout-after-provider-response, and insufficient credit. Local inference must bypass cloud billing.
2. **Billing source of truth:** reconcile `billing_plans` / `au_billing_plans`, `billing_subscriptions` / `au_subscriptions`, `billing_transactions` / `au_payments`, webhook events and entitlements. Current live counts are small but not interchangeable. Preserve Paystack and all transaction history. No table drops until code/FK/RPC/webhook dependencies and a rollback copy are proven.
3. **Model registry:** `au_models_registry` is the canonical model catalogue (four models: two free, two paid); the runtime resolver now reads only this table. `au_pro_models_registry` remains intact as a compatibility/rollback surface; do not drop it until every external/admin consumer is confirmed migrated.
4. **RLS and privileged functions:** review grants plus policies together. RLS-enabled tables with no policies are default-deny for API roles; do not add permissive policies just to silence the advisor. Review every SECURITY DEFINER function's callers, grants and search-path dependencies before changing it.
5. **Migration chain:** restore all missing migration sources, run clean local reset/lint, compare the schema against production, and only then permit CLI db push.
6. **Release:** merge/deploy only after all critical CI, migration-chain, security and Vercel checks pass; then run production auth, billing, usage and AI smoke tests.

## Non-goals of this checkpoint

No document/chat data was moved, no historical billing rows were deleted, no billing registry was renamed/dropped, no secrets were changed, and no customer document storage was removed. Flutter-first local-first architecture remains the target: documents, embeddings, retrieval and chat history stay on-device; Supabase remains the auth/billing/entitlement/usage control plane and stateless AU Cloud gateway.

## Additional work completed

### Canonical model registry — additive first stage
- Added `capabilities text[]` and `size_class text` to `au_models_registry`.
- Copied the two paid models from `au_pro_models_registry` into `au_models_registry` with their capabilities and size classes.
- Live verification now shows all four models in `au_models_registry`: two free and two paid.
- Kept `au_pro_models_registry` intact as a compatibility/rollback surface. The runtime resolver has been switched to `au_models_registry` only; Conex routing overrides remain in the separate `au_model_routing` table. The legacy paid table is not dropped until the remaining consumers are fully inventoried.
- `au_model_usage_stats` continues to reference the canonical `au_models_registry` table.

### Billing dependency map
- Live function references include `apply_verified_billing_payment`, `apply_billing_renewal_failure`, `apply_plan_transition`, `get_active_subscription`, `get_effective_entitlements`, `get_effective_limits`, and admin/manual-payment routines.
- Live foreign keys include `billing_cancellation_feedback.subscription_id → billing_subscriptions.id`, `au_payments.owner_id → au_users.id`, and `au_user_entitlements.plan → au_plans.plan`.
- This confirms that billing tables are not interchangeable just because some similarly named pairs exist. No consolidation or deletion has been performed.
- Current verified counts remain: billing_plans 2 / au_billing_plans 2; billing_subscriptions 1 / au_subscriptions 0; billing_transactions 9 / au_payments 2; billing_webhook_events 0 / au_billing_events 0; entitlement_grants 1 / au_user_entitlements 4.

### CI corrections in progress
- Corrected the protected API regression to assert that the legacy cloud document API fails closed while the actual legacy query helper uses the safe projection.
- Updated static security regressions to match the retired local-first upload endpoint rather than obsolete server-upload behavior.
- Added a final migration that recreates only the empty, metadata-only `au_documents` compatibility shell required by retained plan/limits RPCs; no document contents are stored there.
- Latest CI runs are being re-evaluated. No merge or Vercel production promotion until the critical SaaS and migration-chain workflows are green.


### Additional privileged RPC exposure closed
- Live catalog review found more SECURITY DEFINER functions with direct `anon` / `authenticated` EXECUTE grants than the original billing renewal finding.
- Restricted these high-impact routines to `service_role`: `approve_manual_payment`, `apply_verified_billing_payment`, `apply_plan_transition`, `admin_set_user_plan_override`, `admin_count_auth_users`, `admin_list_auth_users`, and `au_admin_db_stats`.
- Pinned their search paths. The manual-payment routine explicitly lacked an in-function admin check, and the payment/plan-transition routines can write billing and paid entitlement state. Browser roles must not invoke these directly.
- Live privilege verification confirms `anon` and `authenticated` cannot execute any of the seven routines; `service_role` can. No payment, subscription, or entitlement rows were changed.
- The admin plan-assignment API route was inspected and uses the service-role Supabase client. Other callers still require a complete route/function inventory before any broader grant revocation.

### Billing price/source-of-truth discrepancy
- `billing_plans` currently contains Paystack weekly/monthly rows priced at 1,500 / 4,500 NGN (150,000 / 450,000 kobo) with codes `PLN_h3teb0z285iuyet` and `PLN_bo7k3ulauwdhzjl`.
- `au_billing_plans` contains a separate weekly/monthly set priced at 1,900 / 4,500 NGN with different Paystack codes.
- This is a real pricing/provider-plan mismatch, not just duplicate schema. `billing_subscriptions` has one row and `au_subscriptions` has zero; `billing_transactions` has nine rows and `au_payments` has two. No merge/drop is safe until the product price decision and Paystack plan-code mapping are reconciled.
- Current canonical candidate for live Paystack checkout is `billing_plans`, because the verified-payment routine writes `billing_transactions`, `billing_customers`, `entitlement_grants`, and `billing_subscriptions`. The `au_*` structures remain compatibility/history surfaces until callers are proven inactive.


### Remaining SECURITY DEFINER posture after hardening
- Live catalog re-check: zero public SECURITY DEFINER functions remain with a mutable search path.
- The three legacy functions without an explicit path were pinned to `pg_catalog, public`: `au_rate_limit_hit`, `cleanup_inactive_accounts`, and `decide_auth_executor`.
- Legacy admin auth-user count/list and database-stats RPCs were re-revoked from `authenticated` after a follow-up privilege check showed old grants had been restored. Verified: anon/authenticated cannot execute; service_role can.
- Some remaining SECURITY DEFINER functions are intentionally callable by authenticated users because they enforce caller ownership/admin checks internally (effective entitlement/limit reads, username availability, user activity and usage event tracking). These still need route-level regression coverage; no blanket revocation was applied.


### Controlled live atomic-usage smoke test (rolled back)
- Ran a real transaction against the production database using an existing test subject, then explicitly rolled it back.
- Reserve → provider-start → expiry sweep → actual commit → duplicate commit replay all behaved as expected.
- Expiry sweep reported `expired: 0` after provider start, so the in-flight reservation was protected even after its expiry timestamp was moved into the past inside the test transaction.
- Actual settlement preserved the reserved chat count (`max_chats_total: 1)), reconciled estimated tokens from 100 to measured 25, and recorded token metrics.
- Duplicate commit returned `deduped: true` with the same event ID.
- Post-rollback verification found zero smoke reservations, zero smoke events and no smoke counter keys. No production usage or quota rows were retained.


### Paystack / Flutterwave webhook retry safety
- Fixed a real billing reliability defect: the old webhook handler inserted an idempotency row with `processed_at` set before processing, then treated every unique conflict as a completed duplicate. A transient failure after insert could therefore suppress all provider retries.
- Added a service-role-only claim/complete/fail RPC lifecycle with a 180-second processing lease, attempt counter, claim token fencing and sanitized error code.
- Both Paystack and Flutterwave handlers now mark events processed only after all effects succeed; on failure they mark the claim failed and rethrow so the webhook route returns 500 and the provider can retry.
- Concurrent duplicate deliveries during an active lease are acknowledged without double-processing. Failed/stale claims can be reclaimed; an old worker cannot complete a newer claim.
- Live production transaction smoke test (rolled back): first claim acquired, concurrent claim blocked, failure marked, retry acquired a new token, stale token rejected with `WEBHOOK_CLAIM_LOST`, new token completed, and final duplicate recognized as processed. Post-rollback verification found zero smoke webhook rows.


- Additional plan-code drift: the active `billing_plans` monthly row stores `PLN_bo7k3ulauwdhzjl`, while the application fallback catalog expects `PLN_bo7k3ulauwdhzjli` and explicitly lets configured `PAYSTACK_PLAN_MONTHLY_CODE` override stale DB values. The legacy `au_billing_plans` rows carry yet another pair of codes (`PLN_axsdw7s4zniurzr`, `PLN_bc7vhwfff2mqc57`). Do not rewrite any live Paystack plan code until the configured environment value and provider-side plan are verified; current checkout code protects itself by preferring configured/fallback canonical values over stale DB codes.


### Clean migration replay and CI compatibility fixes
- Clean local migration replay exposed two source-history defects: the older `get_effective_limits` definition referenced a retired `au_feature_outputs` relation that does not exist in production, and the restored atomic settlement migration lacked its `ai_usage_delta_units` helper.
- Restored the helper in the historical atomic-commit migration and added a later source-aligned `get_effective_limits` definition matching the live resolver, removing the retired relation dependency without creating a fake output table.
- Pinned the Playwright-heavy critical CI workflow to Ubuntu 24.04 because the latest `ubuntu-latest` image moved to Ubuntu 26.04, which the repository's Playwright Chromium version does not support.
- Migration replay and the full critical workflow are being rerun after these corrections.
