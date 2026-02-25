# VPS Migration Runbook: Upload Worker → 69.164.244.66

## Scope
- Moves the VPS “upload worker” (RAG ingestion + job polling) to the target VPS.
- Keeps Supabase Edge Functions and Supabase Storage as-is (no data moved there).
- Optionally moves Qdrant if Qdrant is currently hosted on the old VPS.

## Components
- Worker: [rag-worker](file:///c:/Users/cruzan/Documents/Datacube-Au/rag-worker)
  - Polls: `public.au_worker_jobs`, `public.au_deletion_log`
  - Reads/Writes: `public.au_documents`, `public.au_document_chunks`
  - Storage: Supabase Storage bucket (default `documents`)
  - Vector store: Qdrant collection(s) (default `au_chunks`)
- Optional scheduled cleanup: `rag-worker/src/cleanup.ts`

## Required Environment Variables (Worker)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `QDRANT_URL`
- `QDRANT_API_KEY` (optional if Qdrant unauthenticated)
- `BUCKET` (optional; default `documents`)
- `WORKER_ID` (recommended: `vps-worker`)
- `WORKER_INSTANCE_ID` (optional; auto-generated)
- `WORKER_POLL_INTERVAL_MS` (default 2000)
- `WORKER_LEASE_MS` (default 300000)
- `WORKER_LEASE_HEARTBEAT_MS` (default 60000)
- `WORKER_CHUNK_SIZE` (default 1000)
- `WORKER_CHUNK_OVERLAP` (default 200)
- `CHUNK_INSERT_BATCH_SIZE` (default 250)
- `EMBED_BATCH_SIZE` (default 96)
- `QDRANT_RETRY_COUNT` (default 3)

## Phase 0 — Preconditions
- Confirm the current worker is indeed the one claiming jobs with `worker_id='vps-worker'`.
- Confirm whether Qdrant is:
  - Managed externally (nothing to move), or
  - Running on the current VPS (must be migrated or pointed to the existing Qdrant host).

## Phase 1 — Inventory & Backup (Old VPS)
Run on the current VPS:

```bash
systemctl list-units --type=service | grep -i -E "rag|worker|datacube|qdrant" || true
systemctl status dcau-rag-worker.service || true
systemctl cat dcau-rag-worker.service || true
ls -la /etc/datacube-au/ || true
journalctl -u dcau-rag-worker.service --since "7 days ago" --no-pager | tail -n 400 || true
```

Back up worker code + env:
```bash
mkdir -p /root/dcau-backups
tar -czf /root/dcau-backups/rag-worker-code.tgz -C /opt/datacube-au rag-worker 2>/dev/null || true
tar -czf /root/dcau-backups/rag-worker-etc.tgz -C /etc datacube-au 2>/dev/null || true
```

If Qdrant runs locally, back up Qdrant storage:
```bash
systemctl status qdrant.service || true
tar -czf /root/dcau-backups/qdrant-var-lib.tgz /var/lib/qdrant 2>/dev/null || true
```

## Phase 2 — Provision Target VPS (69.164.244.66)
SSH:
```bash
ssh root@69.164.244.66
```

Install baseline packages + Node.js (Node 20 LTS example):
```bash
apt-get update
apt-get install -y ca-certificates curl git rsync build-essential
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
node -v
npm -v
```

Create a dedicated user and directories:
```bash
useradd -m -s /bin/bash datacube || true
mkdir -p /opt/datacube-au
chown -R datacube:datacube /opt/datacube-au
mkdir -p /etc/datacube-au
chmod 700 /etc/datacube-au
```

## Phase 3 — Transfer Code
From your workstation (or old VPS), rsync `rag-worker/` and the systemd templates under `ops/`:
```bash
rsync -az --delete ./rag-worker/ root@69.164.244.66:/opt/datacube-au/rag-worker/
rsync -az --delete ./ops/vps-upload-worker/ root@69.164.244.66:/opt/datacube-au/ops/vps-upload-worker/
```

Set ownership:
```bash
chown -R datacube:datacube /opt/datacube-au/rag-worker
```

## Phase 4 — Configure Secrets on Target VPS
Create `/etc/datacube-au/rag-worker.env` on the target VPS (600 perms):
```bash
install -m 600 -o root -g root /dev/null /etc/datacube-au/rag-worker.env
```

Populate it using [rag-worker.env.example](file:///c:/Users/cruzan/Documents/Datacube-Au/ops/vps-upload-worker/rag-worker.env.example) as a template.

## Phase 5 — Build & Install Dependencies (Target VPS)
```bash
cd /opt/datacube-au/rag-worker
sudo -u datacube npm ci
sudo -u datacube npm run build
```

## Phase 6 — Install systemd Services (Target VPS)
Copy unit files:
- [dcau-rag-worker.service](file:///c:/Users/cruzan/Documents/Datacube-Au/ops/vps-upload-worker/dcau-rag-worker.service)
- [dcau-rag-worker-cleanup.service](file:///c:/Users/cruzan/Documents/Datacube-Au/ops/vps-upload-worker/dcau-rag-worker-cleanup.service)
- [dcau-rag-worker-cleanup.timer](file:///c:/Users/cruzan/Documents/Datacube-Au/ops/vps-upload-worker/dcau-rag-worker-cleanup.timer)

```bash
cp /opt/datacube-au/ops/vps-upload-worker/dcau-rag-worker.service /etc/systemd/system/dcau-rag-worker.service
cp /opt/datacube-au/ops/vps-upload-worker/dcau-rag-worker-cleanup.service /etc/systemd/system/dcau-rag-worker-cleanup.service
cp /opt/datacube-au/ops/vps-upload-worker/dcau-rag-worker-cleanup.timer /etc/systemd/system/dcau-rag-worker-cleanup.timer
systemctl daemon-reload
systemctl enable dcau-rag-worker.service
systemctl enable dcau-rag-worker-cleanup.timer
```

Start:
```bash
systemctl start dcau-rag-worker.service
systemctl start dcau-rag-worker-cleanup.timer
systemctl status dcau-rag-worker.service --no-pager
journalctl -u dcau-rag-worker.service -f --no-pager
```

## Phase 7 — Cutover (Stop Old Worker, Start New Worker)
- Pause uploads in the UI (optional).
- Stop old worker:
```bash
systemctl stop dcau-rag-worker.service
```
- Confirm no active leases:
  - In Supabase SQL Editor, check `au_worker_jobs` rows with `status='processing'` and `locked_until > now()`.
- Start/confirm new worker already running.

## Phase 8 — Verification (Before Decommission)
### A) DB-level checks
Confirm new claims by worker instance:
```sql
select id, status, worker_id, claimed_by, locked_at, locked_until, progress, updated_at
from public.au_worker_jobs
where status in ('queued','uploaded','processing')
order by updated_at desc
limit 20;
```

Additional queries are in [verification.sql](file:///c:/Users/cruzan/Documents/Datacube-Au/ops/vps-upload-worker/verification.sql).

### B) Upload end-to-end tests
- Upload: `.txt`, `.pdf`, `.docx`
- Expected:
  - `au_worker_jobs`: transitions `queued` → `processing` → `completed`
  - `au_documents.status`: becomes `completed` (or equivalent success state)
  - `au_document_chunks`: rows created for the document
  - Qdrant: points created in collection `au_chunks` (or your configured collection)

### C) Deletion cascade test
- Delete a document in UI.
- Expected:
  - `au_deletion_log.processed` flips to true
  - vectors removed from Qdrant for `document_id`
  - storage object removed from bucket/path

### D) Permissions & paths
- Ensure worker can read its env: `/etc/datacube-au/rag-worker.env` (root-owned, readable by systemd via EnvironmentFile).
- Ensure worker runs as `datacube` user.

### E) Worker routing diagnostics (service-role read-only)
Run from the repo root (or use [verify-worker.sh](file:///c:/Users/cruzan/Documents/Datacube-Au/ops/vps-upload-worker/verify-worker.sh)):
```bash
node diagnose_vps_worker_routing.cjs
```

## Rollback
- Start old worker again:
```bash
systemctl start dcau-rag-worker.service
```
- Stop new worker:
```bash
ssh root@69.164.244.66 "systemctl stop dcau-rag-worker.service"
```

## Decommission Old VPS
- Keep old VPS running for a safe window (24–72 hours) with worker stopped.
- Archive backups from `/root/dcau-backups/`.
