# DataCube AU Egress Consumer Audit

Last updated: 2026-07-28

Status model:

- Green = fixed/bounded
- Yellow = partly controlled or needs live verification
- Red = high-risk/unbounded
- Grey = cannot verify from repo alone

## Summary

| Area | Status | Notes |
|---|---|---|
| VPS AI Gateway | Yellow | Ticket/CORS/provider/RAG hardening is in code. Live Oracle VPS env and logs still need verification. |
| RAG retrieval | Green | Gateway retrieval requires `user_id` and `document_id`, uses Qdrant top-k/bounded coverage, and has strict limited Supabase fallback. |
| Browser/PWA private caching | Green | Protected API and Supabase requests are network-only; offline queued writes strip Authorization and credential headers. |
| Admin/provider-key pipeline | Yellow | Browser DTOs are masked and legacy admin token storage was removed. Encryption-at-rest upgrade remains. |
| Supabase live policy state | Yellow | Migration adds revokes/RLS/audit metadata, but live status depends on successful Supabase CLI push and staging verification. |

## Supabase Consumers

| Consumer | Status | Evidence | Remaining action |
|---|---|---|---|
| Full document text reads | Green | Normal VPS generation does not read `au_documents.content_text`; document text helper is bounded to 15 chunks/12000 chars in `src/lib/api/documents.ts` and `src/lib/au/documents.ts`. | Keep future generation paths on Qdrant retrieval only. |
| Full chunk reads | Green | VPS retrieval caps top-k/coverage/fallback and hard caps context. Governance hash fallback now limits owner-filtered chunks. | Live query tracing should confirm no unexpected route reads full chunks. |
| Storage downloads | Yellow | RAG worker downloads source objects for ingestion. Owner/path-bound cleanup exists, but live bucket policies and cleanup results need verification. | Verify worker service-role access and post-ingestion cleanup in staging. |
| Worker retry downloads | Yellow | Worker retry logic is bounded by job lifecycle controls, but duplicate-job prevention remains partial. | Add duplicate job/chunk reuse safeguards in a later task. |
| Realtime subscriptions | Yellow | Feature flag/account/admin config channels are targeted, but live fanout and auth behavior need measurement. | Load-test at 1k+ active users. |
| Account snapshot reads | Green | Cached and TTL-bound client path with authenticated server checks. | Verify stale snapshot invalidation in staging. |
| Billing/entitlement reads | Yellow | Server-side entitlement checks are centralized, but usage accounting remains non-atomic by instruction. | Implement reserve/commit/rollback RPC later. |
| Admin user listing | Yellow | Admin APIs use server-side authorization and limits, but large-query scale needs live dataset testing. | Add pagination/cursors for larger admin datasets. |
| Document preview/export | Yellow | Preview helpers are bounded; CSV/export routes should continue avoiding credential fields. | Add route-level export tests if exports expand. |
| Chat history | Yellow | Context/history is capped in gateway; DB growth still needs retention/pagination review. | Add archival/retention policy before 100k users. |
| Feature flags | Green | Cached with ETag/TTL, admin writes require Supabase admin session. | Monitor realtime fanout. |
| Middleware repeated reads | Yellow | Some auth/entitlement checks are repeated by design. | Add request-level memoization where safe. |

## Qdrant Consumers

| Consumer | Status | Evidence | Remaining action |
|---|---|---|---|
| Query count per AI request | Green | AU Chat/document Q&A use one semantic search; generators use one scroll plus at most four intent searches. | Live metrics should record p95 request fanout. |
| Coverage retrieval fanout | Green | `boundedCoverageRetrieval` caps scroll and intent query limits. | Tune per feature after observing quality/cost. |
| Synthesized intent queries | Green | Trimmed, filtered, capped to four. Empty intent queries do not create dummy vectors. | Add quality evals later. |
| Top-k settings | Green | Gateway clamps semantic top-k to 1-20 and coverage limits to bounded ranges. | Use per-feature envs only if product needs differ. |
| Payload size | Green | Context char caps and chunk de-duplication apply before provider calls. | Monitor Qdrant payload bloat. |
| Scroll usage | Yellow | Scroll is bounded for coverage retrieval, but still uses scroll. | Prefer search-only coverage if Qdrant latency increases. |
| Timeout handling | Green | Qdrant operations use bounded timeouts and fallback only when filters exist. | Confirm Oracle VPS timeout env. |

## AI Provider Consumers

| Consumer | Status | Evidence | Remaining action |
|---|---|---|---|
| Context size | Green | Gateway caps message/history/context/past-question text. | Tune caps against quality. |
| Max output tokens | Green | Gateway clamps provider max output with env defaults. | Confirm provider-specific limits in staging. |
| Provider fallback retries | Yellow | Router fallback exists, but failed generation charge policy remains pre-charge in ticket route. | Implement usage reserve/commit/rollback later. |
| Streaming reconnects | Grey | Repo audit did not prove duplicate provider request prevention for all reconnects. | Add idempotency tests around streaming clients. |
| Duplicate requests | Yellow | Some idempotency storage exists, but not globally enforced for all AI requests. | Add request IDs end to end. |
| Failed generation charge policy | Red | Usage is pre-incremented before VPS generation and is not atomic by instruction. | Implement atomic usage accounting in a later task. |

## Browser/PWA Consumers

| Consumer | Status | Evidence | Remaining action |
|---|---|---|---|
| Cached private responses | Green | Protected API routes and Supabase requests are excluded/network-only in PWA config/tests. | Staging verify old service workers purge. |
| Offline queue | Green | Authorization, cookies, API key, admin token, refresh token, and secret headers are stripped. | Browser-level IndexedDB replay test later. |
| localStorage/IndexedDB | Green | Legacy Conex admin token persistence was removed; queued auth headers are scrubbed. | Confirm existing users clear old storage through session cleanup. |
| Chat transcripts | Yellow | Chat context is capped, but transcript retention/growth policy needs live review. | Add chat history retention/pagination before 100k users. |
| Stale JS after deployment | Yellow | PWA cache versioning exists; deployment needs manual old-worker validation. | Test upgrade path after frontend deploy. |
| Client-side document hydration | Yellow | Client document preview helpers are bounded; normal generation is VPS/Qdrant. | Keep hydration out of generation paths. |
