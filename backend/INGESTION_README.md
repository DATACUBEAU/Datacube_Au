# DataCube AU Ingestion Pipeline (VPS Worker)

This document describes the ingestion flow after removing Firebase worker dependencies.

## Architecture

1. **Frontend (`src/components/upload/`)**
   - Uploads files directly to Supabase Storage with TUS.
   - Uses path format:
     - `"{ownerId}/ingestion/main-textbooks/{fileName}"`
     - `"{ownerId}/ingestion/past-questions/{fileName}"`
   - Calls `document-upload` with metadata (no file bytes).

2. **Edge Function (`backend/supabase/functions/document-upload/`)**
   - Validates auth + metadata.
   - Upserts `au_documents`.
   - Upserts `au_upload_jobs` with `status='queued'`.
   - Optionally nudges a VPS webhook (`RAG_WORKER_WEBHOOK_URL` / `VPS_WORKER_URL`).

3. **VPS Worker (`backend/rag-worker/`)**
   - Polls `claim_upload_job()` safely (`FOR UPDATE SKIP LOCKED`).
   - Downloads the uploaded file from Supabase Storage.
   - Chunks text + writes `au_document_chunks`.
   - Generates embeddings + writes `au_document_embeddings`.
   - Marks jobs as `done` / `failed`.

4. **Status Sync**
   - `au_upload_jobs` status updates sync to `au_documents` via trigger (`sync_document_status_from_job`).

## Troubleshooting

If jobs are stuck in `queued` or `processing`:

1. Check jobs:
   ```sql
   SELECT id, status, progress, updated_at
   FROM au_upload_jobs
   ORDER BY created_at DESC
   LIMIT 20;
   ```

2. Check worker claims:
   ```sql
   SELECT * FROM claim_upload_job();
   ```

3. Check logs:
   ```sql
   SELECT * FROM au_debug_logs
   ORDER BY created_at DESC
   LIMIT 50;
   ```

4. If using webhook nudges, verify:
   - `RAG_WORKER_WEBHOOK_URL` (or `VPS_WORKER_URL`)
   - `RAG_WORKER_SECRET` (optional)

## Transformers-Only Mode

When `TRANSFORMERS_FALLBACK_ENABLED=true`, the worker now runs in **Transformers-only** embedding mode:

- FastEmbed initialization/download/cache is skipped entirely.
- Embeddings are generated with `@huggingface/transformers`.
- Default model: `Xenova/all-MiniLM-L6-v2` (override with `TRANSFORMERS_EMBEDDING_MODEL`).

Recommended env values:

- `TRANSFORMERS_FALLBACK_ENABLED=true`
- `TRANSFORMERS_EMBEDDING_MODEL=Xenova/all-MiniLM-L6-v2`
- `HF_CACHE_DIR=/app/local_cache/hf`
- `FASTEMBED_CACHE_DIR=/app/local_cache/fastembed` (kept for non-transformers mode only)

Expected worker logs in transformers-only mode:

- `Transformers-only embedder mode enabled; FastEmbed initialization skipped`
- `Initializing Transformers fallback embedder`
- completion log with `"embedder":"transformers"`

Smoke test command (from `backend/rag-worker`):

```bash
SMOKE_OWNER_ID=<existing_user_uuid> TRANSFORMERS_FALLBACK_ENABLED=true npm run smoke:transformers
```
