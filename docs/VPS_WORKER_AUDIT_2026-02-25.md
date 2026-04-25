# VPS Worker Pipeline Audit (2026-02-25)

## Scope
- File upload pipeline (`document-upload` -> `au_worker_jobs` -> VPS `rag-worker` -> Qdrant)
- Chunk persistence and vector ingestion integrity
- Automatic cleanup/delete lifecycle for original storage objects

## Critical Findings

1. `au_document_chunks` was not queryable from PostgREST (`PGRST205`)
- Impact: worker cannot guarantee chunk row persistence, and integrity checks can fail hard.
- Fix implemented:
  - Added schema hardening migration:
    - `backend/supabase/migrations/20260225013000_worker_pipeline_hardening.sql`
    - `supabase/migrations/20260225013000_worker_pipeline_hardening.sql`
  - Added runtime detection/error messaging in worker ingestion.

2. Qdrant endpoint responded `404` for `/collections`
- Impact: vectors cannot be created/upserted reliably; ingestion can fail even when chunking succeeds.
- Fix implemented:
  - Added explicit Qdrant health failure handling in pipeline audit script.
  - Added retry and stronger error propagation in `rag-worker/src/ingestion.ts`.
- Required ops action:
  - Set `QDRANT_URL` to a valid Qdrant REST endpoint from Qdrant Cloud dashboard.

## High Findings

1. Worker code drift between `rag-worker/` and `backend/rag-worker/`
- Impact: different logic paths could cause inconsistent ingestion/cleanup behavior by environment.
- Fix implemented:
  - Synced hardened worker implementation to both paths.

2. Lease expiry race risk for long-running jobs
- Impact: duplicate processing and data races when lock expires mid-job.
- Fix implemented:
  - Added job lease heartbeat renewal in `rag-worker/src/worker.ts`.

3. Cleanup could mark deletion success when storage deletion failed
- Impact: false `storage_deleted_at` state and data lifecycle inaccuracies.
- Fix implemented:
  - Cleanup now only sets deletion timestamp on successful storage delete.
  - Failure path updates `cleanup_pending`, `cleanup_attempts`, and `cleanup_last_error`.

## Medium Findings

1. Test harness not configured (`jest` failed to parse TS tests)
- Impact: no automated regression signal from worker unit tests.
- Fix implemented:
  - Added `rag-worker/jest.config.cjs` and mirrored in `backend/rag-worker/`.
  - Updated hash assertion to current SHA-256 behavior.

## Performance / Reliability Improvements Implemented

- Batched chunk row inserts (`CHUNK_INSERT_BATCH_SIZE`)
- Batched embeddings/upserts (`EMBED_BATCH_SIZE`)
- Qdrant retries with exponential backoff (`QDRANT_RETRY_COUNT`)
- Strict chunk-row and vector-count verification (document-level integrity)
- Job progress checkpoints and processing metrics logs

## New Audit Tool

- `rag-worker/audit-pipeline.js`
- `backend/rag-worker/audit-pipeline.js`

Run:

```bash
cd rag-worker
node audit-pipeline.js
```

Outputs:
- table accessibility
- queue health
- chunk/vector consistency sample
- cleanup metadata consistency
- severity-ranked findings
