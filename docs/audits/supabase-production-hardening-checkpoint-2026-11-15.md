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
3. **Model registry:** `au_models_registry` currently holds two free models; `au_pro_models_registry` holds two paid models. `au_model_routing` is empty. `au_model_usage_stats` references the free registry. Consolidate additively into `au_models_registry`, preserve the old table as a compatibility surface until code and admin callers move.
4. **RLS and privileged functions:** review grants plus policies together. RLS-enabled tables with no policies are default-deny for API roles; do not add permissive policies just to silence the advisor. Review every SECURITY DEFINER function's callers, grants and search-path dependencies before changing it.
5. **Migration chain:** restore all missing migration sources, run clean local reset/lint, compare the schema against production, and only then permit CLI db push.
6. **Release:** merge/deploy only after all critical CI, migration-chain, security and Vercel checks pass; then run production auth, billing, usage and AI smoke tests.

## Non-goals of this checkpoint

No document/chat data was moved, no historical billing rows were deleted, no billing registry was renamed/dropped, no secrets were changed, and no customer document storage was removed. Flutter-first local-first architecture remains the target: documents, embeddings, retrieval and chat history stay on-device; Supabase remains the auth/billing/entitlement/usage control plane and stateless AU Cloud gateway.
