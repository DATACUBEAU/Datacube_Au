# DataCube AU Post-Hardening Live Test Checklist

Last updated: 2026-07-28

Use this checklist after deploying the VPS/RAG/API-key hardening changes, restarting the Oracle VPS gateway, restarting RAG/background workers, and replacing the legacy Supabase service-role credential with the new `sb_secret` value in server-side secret storage.

Do not print secret values in terminal output, logs, screenshots, tickets, docs, or chat. When checking logs, search for secret-shaped labels and confirm values are redacted or absent.

## 1. Pre-Flight Gate

- [ ] Confirm the frontend/server deployment has the latest commit that includes the hardening changes.
- [ ] Confirm the Oracle VPS gateway has the latest `vps-ai-gateway` code.
- [ ] Confirm the RAG worker deployment has the latest worker code.
- [ ] Confirm cron/background workers are using the updated runtime environment if they use Supabase admin access.
- [ ] Confirm `SUPABASE_SERVICE_ROLE_KEY` is set only in server-side secret storage and now contains the new `sb_secret` credential.
- [ ] Confirm no `SUPABASE_SERVICE_ROLE_KEY`, provider key, Qdrant key, shared secret, webhook secret, or signed ticket is configured as `NEXT_PUBLIC_*`.
- [ ] Confirm `ALLOWED_ORIGINS` contains the production frontend domain and does not use `*`.
- [ ] Confirm `QDRANT_URL` is HTTPS in production or private loopback/VPN-only.
- [ ] Confirm the Supabase migration `20260728120000_api_key_pipeline_hardening.sql` is already applied and the remote database is up to date.

## 2. Restart And Redeploy Order

- [ ] Deploy/restart the frontend server after the env replacement.
- [ ] Restart the Oracle VPS gateway after the env replacement.
- [ ] Restart the RAG worker after the env replacement.
- [ ] Restart any cron/background worker process that uses Supabase admin access.
- [ ] Restart any deployment runner, queue worker, or scheduled process that caches env at process start.
- [ ] Do not disable the legacy service-role credential until all pre-disable tests pass.

## 3. Frontend And Auth Tests

- [ ] Login succeeds for a normal user.
- [ ] Logout and login again succeeds without stale session errors.
- [ ] Dashboard loads without blank screens or auth loops.
- [ ] Account snapshot loads and shows current plan/account state.
- [ ] Billing status loads and does not expose raw billing/provider config.
- [ ] Feature flags load for normal user flows.
- [ ] Old service worker cleanup works after deploy: refresh twice, close/reopen the app, and confirm protected API responses are not served from stale caches.
- [ ] Browser console logs do not show Authorization headers, Supabase service-role/provider keys, Qdrant keys, VPS tickets, cookies, refresh tokens, or stack traces containing env data.
- [ ] Browser network responses do not include raw keys, raw provider credentials, service-role credentials, cookies, or signed tickets except the expected short-lived VPS ticket response from `/api/au/vps-ticket`.

## 4. Admin Panel Tests

- [ ] Admin panel loads for an authorized admin.
- [ ] Admin panel rejects a non-admin user.
- [ ] Admin user list loads from the server-admin path and is not stuck in read-only fallback mode.
- [ ] Admin create/update/delete/reset actions work only for authorized admin users.
- [ ] Provider key page lists provider status, provider name, timestamps, masked metadata, and configured/not configured state only.
- [ ] Provider key create/update accepts a new key but does not echo it back.
- [ ] Provider key revoke/delete does not expose the old key.
- [ ] Admin API responses do not include raw credential rows, service-role keys, provider keys, Authorization headers, cookies, refresh tokens, or signed VPS tickets.
- [ ] Admin server logs do not print raw provider errors, raw upstream responses, stack traces with env data, or secret values.

## 5. Document Upload And RAG Worker Tests

- [ ] Upload a small test document as User A.
- [ ] Confirm upload metadata is created.
- [ ] Confirm the RAG worker claims and processes the job.
- [ ] Confirm chunk metadata is written to Supabase Postgres.
- [ ] Confirm vectors are written to Qdrant with `user_id` and `document_id` payload fields.
- [ ] Confirm the document reaches completed/ready status.
- [ ] Confirm source file cleanup runs after successful ingestion where cleanup is enabled.
- [ ] Confirm worker retry behavior is bounded and does not repeatedly download the same completed source.
- [ ] RAG worker logs do not show document text previews, Authorization headers, Supabase service-role/provider keys, Qdrant keys, cookies, refresh tokens, or raw extracted text.

## 6. AI And RAG Feature Tests

- [ ] AU Chat succeeds with a valid VPS ticket.
- [ ] Global Chat succeeds with a valid VPS ticket.
- [ ] Document Q&A returns an answer grounded in the selected document.
- [ ] Document Q&A includes citations/source metadata.
- [ ] Knowledge Hub generation works and uses bounded retrieval.
- [ ] Practice Exam generation works and uses bounded retrieval.
- [ ] Exam Prediction generation works and uses bounded retrieval.
- [ ] Prompt Starters generation works and uses bounded retrieval.
- [ ] Normal generation does not use full `au_documents.content_text`.
- [ ] Normal generation does not fetch and join all chunk text for a whole document.
- [ ] Provider error responses are sanitized in the browser.
- [ ] Failed provider calls do not expose provider response bodies or credentials.

## 7. VPS Ticket And Boundary Tests

- [ ] `/health` returns only non-secret health/status metadata.
- [ ] Public chat/generation routes return 401 without a VPS ticket.
- [ ] A malformed VPS ticket is rejected.
- [ ] An expired VPS ticket is rejected.
- [ ] A tampered VPS ticket is rejected.
- [ ] A ticket issued for one route is rejected on a different route.
- [ ] A ticket issued for one feature is rejected for another feature.
- [ ] Browser-supplied `user_id`, `feature`, or `route` fields are ignored in favor of verified ticket claims.
- [ ] Oracle VPS logs do not show Authorization headers, signed tickets, provider keys, Supabase keys, Qdrant keys, cookies, refresh tokens, or raw provider responses.

## 8. Cross-User RAG Denial Tests

- [ ] User A uploads and ingests a document.
- [ ] User B cannot list, preview, or ask questions against User A's document through the normal UI.
- [ ] User B cannot retrieve User A's chunks by changing request body fields.
- [ ] A VPS ticket for User B cannot retrieve User A's Qdrant points because both `user_id` and `document_id` filters are required.
- [ ] Missing `document_id` or missing `user_id` retrieval filters fail closed.
- [ ] Cross-user retrieval attempts produce no chunks and no leaked citations.

## 9. Public Asset And Cache Tests

- [ ] `public/` assets do not contain service-role keys, provider keys, Qdrant keys, shared secrets, webhook secrets, cookies, refresh tokens, or signed tickets.
- [ ] Service worker output does not contain service-role/provider key values.
- [ ] Service worker output does not contain the service-role env var name in static client assets.
- [ ] Offline queue entries do not persist Authorization headers, cookies, API keys, admin tokens, refresh tokens, or signed VPS tickets.
- [ ] Private Supabase/API GET requests are network-only or no-store.

## 10. Legacy Service-Role Disable Gate

Complete this gate before disabling the legacy Supabase service-role credential:

- [ ] Frontend/server tests pass with the new `sb_secret` credential.
- [ ] Oracle VPS gateway tests pass with the new runtime environment.
- [ ] RAG worker tests pass with the new runtime environment.
- [ ] Cron/background worker tests pass if those workers use Supabase admin access.
- [ ] Admin user write actions work and do not fall back to read-only mode.
- [ ] Worker ingestion and cleanup work without service-role auth errors.
- [ ] Logs for frontend/server, Oracle VPS gateway, RAG worker, and cron/background workers show no secrets.
- [ ] Public assets and build output show no service-role/provider keys.
- [ ] No failed live test requires reverting to the legacy credential.

## 11. Post-Disable Smoke Tests

After disabling the legacy service-role credential:

- [ ] Login still succeeds.
- [ ] Dashboard and account snapshot still load.
- [ ] Admin user list and safe admin write action still work.
- [ ] Billing status still loads.
- [ ] Document upload and worker processing still complete.
- [ ] AU Chat, Global Chat, and document Q&A still work.
- [ ] VPS invalid/expired/wrong-route token tests still fail closed.
- [ ] Worker and VPS logs remain secret-free.

If any post-disable test fails with service-role authentication errors, treat the disablement as incomplete and restore service health without printing or sharing either credential value.
