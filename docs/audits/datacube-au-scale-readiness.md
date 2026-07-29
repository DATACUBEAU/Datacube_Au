# DataCube AU Scale Readiness

Last updated: 2026-07-28

Status model:

- Green = ready after this pass
- Yellow = acceptable short term, needs live verification or tuning
- Red = must fix before the stated scale
- Grey = cannot verify from repo alone

Atomic usage accounting is now implemented through a Supabase-backed reserve -> commit -> release lifecycle. Live Oracle VPS validation and cleanup scheduling still remain before serious public load.

## Before 1,000 Active Users

| Area | Status | Required action |
|---|---|---|
| VPS concurrency | Yellow | Set process manager restart policy, memory limit, and provider timeout envs; verify p95 latency. |
| Node.js memory | Yellow | Confirm gateway memory under concurrent streaming/generation load. |
| FastEmbed CPU/RAM | Yellow | Warm model cache and confirm gateway embedding latency on Oracle VPS shape. |
| Qdrant query load | Green | Retrieval is top-k/bounded and tenant-filtered. |
| Supabase read/write pressure | Yellow | Watch usage/event writes and admin list limits. |
| Realtime fanout | Yellow | Existing subscriptions are narrow, but live channel count needs measurement. |
| Worker queue throughput | Yellow | Confirm upload job claim/complete rate and retry behavior. |
| Worker retries | Yellow | Retry cleanup is bounded; duplicate downloads still need review. |
| AI provider rate limits | Yellow | Configure provider timeout/output caps and monitor 429s. |
| Usage accounting race conditions | Green | `reserve_ai_usage` locks usage counter rows, dedupes by `(user_id, feature_key, idempotency_key)`, rejects payload-swapped idempotency reuse, and gateway begin blocks duplicate provider starts for active reservations. |
| Billing webhook idempotency | Yellow | Webhook size/rate limits exist; verify idempotent writes in staging. |
| PWA/offline sync load | Green | Private Authorization is not persisted; protected APIs are network-only. |
| Logging volume | Yellow | Logs are redacted; add sampling/retention policy. |
| Admin dashboard large queries | Yellow | Most lists are capped; add pagination where missing. |
| Chat history growth | Yellow | Context is capped; storage retention/pagination needs policy. |
| Vector collection growth | Yellow | Qdrant indexes and retention need live sizing. |
| Cost explosion risks | Yellow | Atomic accounting is implemented; provider budget caps, anomaly alerts, and live disputed-reservation monitoring remain. |

## Before 10,000 Active Users

| Area | Status | Required action |
|---|---|---|
| VPS concurrency | Red | Add horizontal scaling or queueing; test with production-like prompt sizes. |
| Node.js memory | Red | Separate embedding/retrieval from provider streaming if memory pressure appears. |
| FastEmbed CPU/RAM | Red | Move query embeddings to a dedicated embedding service or pre-warmed worker pool if Oracle CPU saturates. |
| Qdrant query load | Yellow | Add Qdrant metrics, payload-size limits, and collection index review. |
| Supabase read/write pressure | Yellow | Atomic reservation writes add correctness under concurrency; measure write amplification and add batching/partitioning if needed. |
| Realtime fanout | Red | Replace broad realtime fanout with targeted invalidation/polling for non-critical admin views. |
| Worker queue throughput | Red | Add queue partitioning, worker concurrency limits, and backpressure. |
| Worker retries | Yellow | Add duplicate-job prevention and retry budget dashboards. |
| AI provider rate limits | Red | Add provider rate-limit scheduler and circuit breakers. |
| Usage accounting race conditions | Yellow | Atomic accounting is implemented; load-test concurrent reserves/releases against production-like Supabase limits. |
| Billing webhook idempotency | Yellow | Add replay tests and webhook idempotency dashboard. |
| PWA/offline sync load | Yellow | Add queue compaction and replay budgets. |
| Logging volume | Red | Add structured log sampling, retention, and sensitive-field enforcement. |
| Admin dashboard large queries | Red | Cursor pagination and aggregate materialization required. |
| Chat history growth | Red | Add retention, summary compaction, and indexed pagination. |
| Vector collection growth | Yellow | Add per-user/document retention and delete reconciliation. |
| Cost explosion risks | Red | Add hard provider budget caps, quota dashboards, anomaly alerts, and circuit breakers. |

## Before 100,000 Active Users

| Area | Status | Required action |
|---|---|---|
| VPS concurrency | Red | Multi-region or autoscaled gateway pool with load balancing. |
| Node.js memory | Red | Split gateway, retrieval, and provider streaming workloads. |
| FastEmbed CPU/RAM | Red | Dedicated embedding service and model cache strategy. |
| Qdrant query load | Red | Sharding/replication, payload pruning, and query admission control. |
| Supabase read/write pressure | Red | Move high-volume telemetry/events to a queue/warehouse path. |
| Realtime fanout | Red | Event aggregation and targeted subscriptions only. |
| Worker queue throughput | Red | Managed queue, horizontal workers, dead-letter queues, and backpressure. |
| Worker retries | Red | Retry dedupe, poison-job quarantine, and cost-aware retry policy. |
| AI provider rate limits | Red | Multi-provider quota scheduler and per-user request admission. |
| Usage accounting race conditions | Yellow | Atomic accounting exists, but needs high-concurrency load tests, cleanup scheduling, and reconciliation dashboards. |
| Billing webhook idempotency | Red | Strong idempotency and reconciliation jobs are mandatory. |
| PWA/offline sync load | Yellow | Client replay budgets and server idempotency keys. |
| Logging volume | Red | Centralized observability with redaction and retention controls. |
| Admin dashboard large queries | Red | Read replicas/materialized analytics required. |
| Chat history growth | Red | Tiered storage and summaries required. |
| Vector collection growth | Red | Lifecycle policy and per-document vector cleanup required. |
| Cost explosion risks | Red | Hard budget guardrails and anomaly kill switches. |

## Before 1,000,000 Active Users

| Area | Status | Required action |
|---|---|---|
| VPS concurrency | Red | Global gateway fleet, autoscaling, regional routing, and graceful degradation. |
| Node.js memory | Red | Stateless gateway edge tier with separate retrieval/provider services. |
| FastEmbed CPU/RAM | Red | Dedicated embedding platform with batching and model-version governance. |
| Qdrant query load | Red | Clustered vector architecture, tenancy partitioning, and cold data lifecycle. |
| Supabase read/write pressure | Red | Separate OLTP, event, analytics, and billing stores. |
| Realtime fanout | Red | Pub/sub architecture with topic-level authorization. |
| Worker queue throughput | Red | Multi-queue ingestion platform with priority, quotas, and DLQs. |
| Worker retries | Red | Full retry governance and automatic cleanup reconciliation. |
| AI provider rate limits | Red | Provider marketplace/routing layer with quota forecasting. |
| Usage accounting race conditions | Red | Evolve reservation accounting into a ledger-grade accounting/reconciliation system. |
| Billing webhook idempotency | Red | Audited billing ledger, idempotency, and replay tooling. |
| PWA/offline sync load | Red | Sync protocol with conflict resolution and replay throttling. |
| Logging volume | Red | Data lake/observability pipeline with privacy budgets. |
| Admin dashboard large queries | Red | Dedicated admin analytics warehouse. |
| Chat history growth | Red | Summaries, archival, deletion SLAs, and compliance workflow. |
| Vector collection growth | Red | Partitioned vector lifecycle, cleanup SLAs, and per-tenant quotas. |
| Cost explosion risks | Red | Real-time cost controls, hard stops, and plan-level throttling. |

## Fixes Applied In This Pass

- Gateway auth, CORS, ticket verification, provider error sanitization, and log redaction.
- Atomic AI usage reservations with service-role-only reserve, begin, commit, release, and expiry RPCs.
- Qdrant retrieval filters and bounded fallback.
- Browser/admin credential DTO masking.
- Offline Authorization safety and PWA private cache safety assertions.
- Credential metadata/audit migration for provider key tables.

## Explicitly Deferred

- Full provider quota scheduler.
- Dedicated embedding service.
- Encryption-at-rest migration for provider key values.
- Large-scale realtime replacement.
