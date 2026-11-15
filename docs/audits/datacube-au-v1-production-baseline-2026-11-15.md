# DataCube AU V1 production baseline — 2026-11-15

This is a read-only baseline captured from GitHub main and the connected Supabase production project. It is not a claim that the issues below have been fixed.

## Repository and deployment snapshot

- Repository: DATACUBEAU/Datacube_Au
- Default branch: main
- Main SHA inspected: `5f21e7b54490548589b4c74e36506ccf16d7e03c`
- Main's latest combined status returned only a successful Vercel check; it did not establish that all critical CI/security workflows passed.
- Open PRs at inspection: #24, #21, #19, #17, #16, #15, #14, #13, #12, #11, #10, #9, #7 and #5.
- PR #21 and #16 concern RAG worker lease fencing. They must not be merged automatically because the V1 target retires server-side document ingestion after Flutter parity.
- PR #7 reports the missing Strix LLM credential as a blocker to a genuine scan. A nominal green result is not evidence of a completed credential-backed scan.
- PR #19 concerns privileged billing RPC scope and needs review against the current live grants before merge.

## Live model registry findings

Exact live row counts at inspection:

| Object | Rows |
|---|---:|
| `au_models_registry` | 2 |
| `au_pro_models_registry` | 2 |
| `au_model_routing` | 0 |
| `au_model_usage` | 26 |
| `au_model_usage_stats` | 0 |
| `ai_usage_reservations` | 0 |

- `src/lib/server/ai-routing.ts` defines `MODEL_REGISTRY_TABLES = ['au_pro_models_registry', 'au_models_registry']` and unions both registries when finding paid models.
- `au_models_registry` already has `is_free`, `type`, provider, context window and rate-limit columns. It has an authenticated SELECT policy.
- `au_pro_models_registry` separately stores capabilities and size class; it has RLS enabled but no policies according to the current security advisor.
- The paid catalogue currently contains two distinct rows: Gemini 2.5 Flash Lite and GPT-5 Nano. The free catalogue contains two rows: Gemini 2.0 Flash Lite Preview and Llama 3 8B.
- The canonical table has a foreign key from `au_model_usage_stats.model_id`; the Pro registry has no foreign-key dependents in the inspected constraint inventory.
- `au_model_routing` has no rows and the inspected resolver does not use it. It is not a live source of truth.
- Target: one `au_models_registry` table for all models, using `is_free`/tier metadata and common capability/pricing fields. Preserve a read-only compatibility view for the old Pro name during rollout; do not drop the retained legacy data until the rollback window and code-reference checks pass.

## Live billing and usage counts

| Object | Rows |
|---|---:|
| `billing_plans` | 2 |
| `au_billing_plans` | 2 |
| `billing_subscriptions` | 1 |
| `au_subscriptions` | 0 |
| `billing_transactions` | 9 |
| `au_payments` | 2 |
| `billing_webhook_events` | 0 |
| `au_billing_events` | 0 |
| `entitlement_grants` | 1 |
| `au_user_entitlements` | 4 |
| `usage_counters` | 24 |
| `usage_totals` | 4 |
| `au_usage_events` | 0 |

Counts are snapshots, not proof that a table is safe to delete. Reconcile rows, foreign keys, RPCs, triggers, views, application references and external clients before retiring any object. Paystack remains the preferred billing authority per the V1 contract.

## Migration-source drift — P0 blocker

- The repository contains both `supabase/migrations` and `backend/supabase/migrations`.
- The package script uses `supabase --workdir backend db push`, so the backend directory is the configured CLI workdir for that script.
- The live migration history includes `20261115183703`, `20261115183910`, `20261115195306`, `20261115195524` and `20261115195956`.
- The backend migration directory inspected on main did not contain all of those live versions; the root migration directory also has a different sequence and additional entries.
- Do not run `db push`, `migration repair`, or create another production migration until the canonical migration directory and exact live history are reconciled. A mismatched migration source can cause an unsafe or misleading deployment.

## Security advisor snapshot

Security advisor findings at inspection included:
- 1 ERROR: `billing_renewal_attempts` is in the exposed public schema with RLS disabled.
- 27 SECURITY DEFINER functions reported executable by anon, and 27 by authenticated. Each function needs caller/grant/body review; do not mass-revoke without tracing intended server/client callers.
- 26 functions with mutable search_path.
- 15 tables with RLS enabled and no policies (some may be intentionally service-role-only; verify grants and call paths).
- Leaked-password protection is disabled.
- `pg_net` is installed in public schema.
- Multiple permissive policy warnings: 74.
- Performance advisor findings included 12 unindexed foreign keys, 49 auth/RLS initplan findings, 66 unused indexes, and 2 duplicate-index findings (`au_admin_email_alerts`, `au_model_usage`).

## Atomic usage snapshot

- Live reservation table count was zero at inspection; legacy usage projections still had rows.
- The current codebase contains reservation/commit/release RPC paths and migrations for actual usage commit and in-flight reservation protection, but production correctness still requires an end-to-end trace of every cloud inference route and concurrency/retry tests.
- Confirm local inference bypasses cloud reservations and cloud inference cannot bypass reservation/settlement.
- Do not infer that atomic accounting is production-proven from table/function existence alone.

## Immediate next steps

1. Reconcile the two migration directories with the live migration history; produce one canonical migration source and an exact repair plan.
2. Inventory every code, admin, RPC, trigger, view, FK and Edge Function reference to both model registries.
3. Prepare a reviewed, additive-first model consolidation migration: enrich `au_models_registry`, copy/validate all Pro rows, then replace `au_pro_models_registry` with a read-only compatibility view backed by the canonical table. Keep a retained backup table for rollback; no data deletion in the first cutover.
4. Update every resolver/admin/model catalogue client to read and write only `au_models_registry`; add tests proving paid and free routing, hidden-model filtering and compatibility behavior.
5. Triage the RLS-disabled billing table and each privileged RPC individually, based on real callers and least privilege.
6. Trace every cloud inference route through reserve -> provider-start -> commit/release -> usage ledger and run concurrency, replay, ambiguous-timeout and provider-failure tests.
7. Verify the Flutter vertical slice before retiring server document/chat tables, buckets, functions or workers.
8. Only after reviewed PR, backup/disposition plan and explicit approval: apply production migrations, verify counts/policies/RPC behavior, deploy code/functions and run smoke tests.
