# Oracle VPS Gateway Update

Last updated: 2026-07-30

Use this after the code and Supabase migrations are deployed. The owner-confirmed remote database is up to date for `supabase/migrations/20260728120000_api_key_pipeline_hardening.sql`, `supabase/migrations/20260728153000_atomic_usage_accounting.sql`, `supabase/migrations/20260728154500_atomic_usage_limit_scope_fix.sql`, `supabase/migrations/20260728160000_atomic_usage_replay_guard.sql`, `supabase/migrations/20260729120000_provider_key_encryption_columns.sql`, `supabase/migrations/20260729153000_username_uniqueness.sql`, and `supabase/migrations/20260730120000_retention_production_runtime.sql`; do not create or push another migration for the service-role replacement, provider-key encryption, username uniqueness, or retention runtime unless a new schema blocker is proven.

Do not paste secrets into shell history. Store secret values in your deployment secret manager, PM2 ecosystem file outside git, systemd environment file outside git, or Docker/Compose secret environment that is not committed. `SUPABASE_SERVICE_ROLE_KEY` should now hold the new `sb_secret` value everywhere it is needed server-side.

## A. Files And Services Affected

| Item | Must update | Notes |
|---|---:|---|
| `vps-ai-gateway` | Yes | Deploy TypeScript gateway changes for ticket verification, CORS, RAG filters, provider sanitization, limits, logging, and atomic usage commit/release. Restart after env replacement. |
| Frontend deployment | Yes | Redeploy after env replacement so Next.js server routes, middleware, admin routes, billing routes, and background routes use the new service-role credential. |
| RAG worker | Yes | Restart after env replacement. Worker embedding model must remain compatible with gateway retrieval: `AllMiniLML6V2` unless both sides are intentionally changed together. |
| Cron/background workers | If used | Restart any process that uses Supabase admin access or caches env at process start. Add/schedule `expire_ai_usage_reservations` cleanup if not already covered. Document retention cleanup is already configured for Vercel Cron in `vercel.json`; do not add a competing Oracle scheduler unless Vercel Cron is intentionally disabled. |
| Environment variables | Yes | Add/check required names below on both frontend server and Oracle VPS. Keep values out of logs and docs. |
| Nginx/reverse proxy | Verify | Ensure only intended gateway domain/path proxies to the gateway port over HTTPS. |
| PM2/systemd/Docker service | Yes | Restart the gateway after code/env updates. |
| Firewall/security list | Verify | OCI ingress should allow only HTTPS/SSH and the private gateway port if required by reverse proxy topology. |
| Qdrant config | Verify | `QDRANT_URL` should use HTTPS in production unless Qdrant is private loopback/VPN-only. |
| Supabase keys/config | Yes | `SUPABASE_SERVICE_ROLE_KEY` should contain the new `sb_secret` value. Disable the legacy service-role credential only after restart and live tests pass. |

## B. Required Oracle VPS Env Vars

Required or commonly used on the Oracle VPS gateway:

```text
NODE_ENV
PORT
HOST
VPS_SHARED_SECRET
ALLOWED_ORIGINS
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_ANON_KEY
QDRANT_URL
QDRANT_API_KEY
QDRANT_COLLECTION
QDRANT_TIMEOUT_MS
OPENAI_API_KEY
OPENROUTER_API_KEY
ANTHROPIC_API_KEY
AI_PROVIDER_TIMEOUT_MS
AI_MAX_OUTPUT_TOKENS
AI_MAX_CONTEXT_CHARS
AI_MAX_HISTORY_CHARS
AI_MAX_MESSAGE_CHARS
AI_MAX_PAST_QUESTION_CONTEXT_CHARS
RATE_LIMIT_MAX_PER_MINUTE
# Retention cron authorization is frontend/server-side for Vercel Cron,
# not normally required on the Oracle VPS gateway when Vercel Cron is active:
CRON_SECRET
RETENTION_CRON_SECRET
DCAU_ALLOW_INSECURE_DEV_VPS_SECRET
```

Frontend/server-only provider-key management env vars:

```text
PROVIDER_KEY_ENCRYPTION_SECRET
```

Production requirements:

- `NODE_ENV` must be `production`.
- `VPS_SHARED_SECRET` must match the frontend/Next.js server env exactly.
- `SUPABASE_SERVICE_ROLE_KEY` must contain the new `sb_secret` credential in every server-side runtime that uses Supabase admin access. The VPS gateway now requires this key because atomic usage commit/release RPCs are service-role only.
- `PROVIDER_KEY_ENCRYPTION_SECRET` must be configured on the frontend/admin server before using Conex provider-key create/update. It is not needed in browser code and must not be sent to the Oracle VPS unless that service is later changed to decrypt database-stored provider keys directly.
- `ALLOWED_ORIGINS` must be an explicit comma-separated allowlist, never `*`.
- `QDRANT_URL` should be HTTPS in production. Loopback/private network URLs are acceptable only if Qdrant is not publicly reachable.
- No provider key or Supabase service-role key may be defined with `NEXT_PUBLIC_*`.
- Do not disable the legacy service-role credential until frontend, Oracle VPS gateway, RAG worker, and relevant cron/background worker live tests pass.
- Do not print env values in commands, logs, screenshots, docs, or support tickets.

## C. Oracle VPS Update Commands

PM2:

```bash
cd /path/to/Datacube-Au
git pull origin main
cd vps-ai-gateway
npm ci
npm run build
pm2 restart vps-ai-gateway
pm2 logs vps-ai-gateway
```

systemd:

```bash
cd /path/to/Datacube-Au
git pull origin main
cd vps-ai-gateway
npm ci
npm run build
sudo systemctl restart vps-ai-gateway
sudo journalctl -u vps-ai-gateway -f
```

Docker:

```bash
cd /path/to/Datacube-Au
git pull origin main
docker compose build vps-ai-gateway
docker compose up -d vps-ai-gateway
docker logs -f vps-ai-gateway
```

Frontend deployment:

```bash
cd /path/to/Datacube-Au
git pull origin main
npm ci
npm run build
```

Use your actual deployment command after the build step.

RAG worker:

systemd:

```bash
cd /path/to/Datacube-Au
git pull origin main
cd rag-worker
npm ci
npm run build
sudo systemctl restart dcau-rag-worker
sudo journalctl -u dcau-rag-worker -f
```

If the cleanup worker is deployed as a systemd oneshot/timer, run or restart the associated unit after env replacement:

```bash
sudo systemctl restart dcau-rag-worker-cleanup
sudo journalctl -u dcau-rag-worker-cleanup -n 100
```

Docker Compose from `rag-worker/` or `backend/rag-worker/`:

```bash
docker compose build worker
docker compose up -d worker
docker compose logs -f worker
```

PM2, if used:

```bash
pm2 restart dcau-rag-worker
pm2 logs dcau-rag-worker
```

Inspect logs without printing or copying secret values.

Cron/background workers:

```bash
cd /path/to/Datacube-Au
git pull origin main
npm ci
npm run build
```

Restart each scheduler or background service that uses Supabase admin access. Examples include retention jobs, background config jobs, worker cleanup jobs, and deployment-specific queue consumers.

Atomic usage cleanup:

- Schedule a server-side cron/background call to `expire_ai_usage_reservations` using Supabase service-role access.
- Run it frequently enough that stale reserved quota does not linger, for example every 5-15 minutes.
- Do not call it from browser code.

Document retention cleanup:

- Use the existing Vercel Cron configuration in `vercel.json`: `/api/cron/retention` once per day.
- Configure one cron authorization secret in the frontend/server deployment secret storage. Prefer `CRON_SECRET` for Vercel Cron; use `RETENTION_CRON_SECRET` only if intentionally separating document-retention authorization. The route accepts either configured name, but do not configure both unless you intentionally want either value accepted.
- For initial reporting, call `/api/cron/retention?dryRun=1` from a server-only context. Send the cron secret in `x-cron-secret` or an `Authorization: Bearer` header without printing the value in shell history, logs, screenshots, or docs.
- Keep the batch size bounded with the route `limit` query parameter during rollout.
- Verify dry-run responses contain aggregate counts only, not document names, file paths, emails, tokens, or private user data.
- Confirm `20260730120000_retention_production_runtime.sql` remains applied before relying on retention cleanup in production. It creates retention action/run tables, owner metadata, lease RPCs, RLS/revokes/grants, and indexes.
- Do not configure a second Oracle cron/systemd timer for document retention while Vercel Cron is active.

## D. Oracle Cloud Networking Checklist

| Check | Required result |
|---|---|
| Gateway port | The local gateway listens on `PORT`; do not expose it directly if Nginx terminates HTTPS. |
| Nginx reverse proxy | Public domain/path forwards only to the gateway service. |
| HTTPS certificate | Valid certificate for the gateway domain. |
| OCI Security List / NSG | Inbound allows only needed ports, typically 443 and restricted SSH. |
| Health endpoint | `/health` returns non-secret status only. |
| Frontend origin | Frontend production domain is present in `ALLOWED_ORIGINS`. |
| Public generation endpoints | `/chat/*` and `/generate/*` return 401 without a valid VPS ticket. |
| Qdrant | Not publicly reachable without auth; prefer HTTPS/private network. |

## E. Post-Update Live Tests

Run these after restarting services:

- `GET /health` returns healthy metadata with no secrets.
- AU Chat succeeds with a valid ticket.
- Global Chat succeeds with a valid ticket.
- Document upload creates a worker job.
- Qdrant document question returns cited chunks from the correct document.
- Knowledge Hub uses bounded document retrieval.
- Practice Exam uses bounded document retrieval.
- Exam Prediction uses bounded document retrieval.
- Prompt Starters use bounded document retrieval.
- Invalid, expired, malformed, and tampered tickets return 401.
- A ticket for one route is rejected on a different route.
- Reusing the same idempotency key does not double-charge or start duplicate in-flight provider attempts.
- Provider failure/timeout releases the reservation instead of committing usage.
- Successful provider response commits exactly once.
- Cross-user retrieval attempts return no chunks.
- Gateway logs do not show Authorization headers, tickets, provider keys, Supabase keys, Qdrant keys, or raw provider responses.
- Conex provider-key create/update succeeds without echoing the submitted key and subsequent provider routing works with the encrypted stored value.
- Session-expired reauthentication redirects once to `/session-expired`, preserves a safe local return path, and does not trigger refresh/reload loops.
- Data Security Notice appears on signup, upload/documents, and settings surfaces with the required wording.
- Retention dry-run returns counts only; a controlled disposable-document cleanup removes Storage, Postgres metadata/chunks/artifacts, and Qdrant vectors for that owner/document only.
- Optional AU onboarding respects completed/skipped/maybe-later state and can be restarted from Help.
- Mobile PWA install control appears at small widths when eligible and hides in standalone mode.

## Oracle VPS Secret And API Key Checklist

Store these only in server-side environment/secrets storage:

```text
VPS_SHARED_SECRET
SUPABASE_SERVICE_ROLE_KEY
QDRANT_API_KEY
OPENAI_API_KEY
OPENROUTER_API_KEY
ANTHROPIC_API_KEY
PAYSTACK_SECRET_KEY
PAYSTACK_SECRET
FLUTTERWAVE_SECRET_KEY
FLUTTERWAVE_WEBHOOK_SECRET_HASH
PROVIDER_KEY_ENCRYPTION_SECRET
RETENTION_CRON_SECRET
CRON_SECRET
```

`SUPABASE_SERVICE_ROLE_KEY` should now be the new `sb_secret` credential. Keep the legacy service-role credential enabled only long enough to complete the restart and live-test checklist.

Values that must match frontend/server env:

```text
VPS_SHARED_SECRET
SUPABASE_URL
QDRANT_COLLECTION
```

Values that must never be in frontend `NEXT_PUBLIC_*`:

```text
SUPABASE_SERVICE_ROLE_KEY
QDRANT_API_KEY
OPENAI_API_KEY
OPENROUTER_API_KEY
ANTHROPIC_API_KEY
PAYSTACK_SECRET_KEY
PAYSTACK_SECRET
FLUTTERWAVE_SECRET_KEY
FLUTTERWAVE_WEBHOOK_SECRET_HASH
VPS_SHARED_SECRET
PROVIDER_KEY_ENCRYPTION_SECRET
RETENTION_CRON_SECRET
CRON_SECRET
```

Restart after env changes using your supervisor:

```bash
pm2 restart vps-ai-gateway
```

```bash
sudo systemctl restart vps-ai-gateway
```

```bash
docker compose up -d vps-ai-gateway
```

Verify logs without printing secrets:

```bash
pm2 logs vps-ai-gateway
```

```bash
sudo journalctl -u vps-ai-gateway -f
```

```bash
docker logs -f vps-ai-gateway
```

Look for secret-shaped labels only, not values: `Authorization`, `Bearer`, provider key names, Supabase key names, Qdrant key names, and raw provider response bodies. The gateway should log configuration presence as booleans/counts only.

Verify public endpoints do not expose config:

```bash
curl -i https://YOUR_GATEWAY_DOMAIN/health
curl -i https://YOUR_GATEWAY_DOMAIN/chat/au-chat
curl -i https://YOUR_GATEWAY_DOMAIN/generate/practice-exam
```

Expected result: health is non-secret; generation/chat routes reject without a valid ticket.

## Legacy Service-Role Disable Gate

Before disabling the legacy Supabase service-role credential:

- Frontend/server has been redeployed with the new `SUPABASE_SERVICE_ROLE_KEY`.
- Frontend/server has `PROVIDER_KEY_ENCRYPTION_SECRET` configured if database-stored provider keys are managed through Conex.
- Oracle VPS gateway has been restarted with the new environment.
- RAG worker has been restarted with the new environment.
- Cron/background workers using Supabase admin access have been restarted.
- Admin user list and at least one safe admin write action work without read-only fallback.
- Document upload, worker ingestion, Qdrant write, and source cleanup pass.
- AU Chat, Global Chat, document Q&A, Knowledge Hub, Practice Exam, Exam Prediction, and Prompt Starters pass.
- Invalid/expired/wrong-route VPS ticket tests fail closed.
- Frontend, Oracle VPS gateway, RAG worker, and cron/background logs contain no raw secrets, Authorization headers, cookies, refresh tokens, provider keys, Qdrant keys, Supabase keys, or signed VPS tickets.
- Public assets and service worker output contain no service-role/provider key values.

Use `docs/deployment/post-hardening-live-test-checklist.md` as the full checklist.
