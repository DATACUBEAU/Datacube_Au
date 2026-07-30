# DataCube AU Post-Hardening Live Test Checklist

Last updated: 2026-07-30

Use this checklist after deploying the VPS/RAG/API-key/auth-entry/retention/onboarding/PWA hardening changes, restarting the Oracle VPS gateway, restarting RAG/background workers, and replacing the legacy Supabase service-role credential with the new `sb_secret` value in server-side secret storage.

Do not print secret values in terminal output, logs, screenshots, tickets, docs, or chat. When checking logs, search for secret-shaped labels and confirm values are redacted or absent.

## 1. Pre-Flight Gate

- [ ] Confirm the frontend/server deployment has the latest commit that includes the hardening changes.
- [ ] Confirm the Oracle VPS gateway has the latest `vps-ai-gateway` code.
- [ ] Confirm the RAG worker deployment has the latest worker code.
- [ ] Confirm cron/background workers are using the updated runtime environment if they use Supabase admin access.
- [ ] Confirm `SUPABASE_SERVICE_ROLE_KEY` is set only in server-side secret storage and now contains the new `sb_secret` credential.
- [ ] Confirm `PROVIDER_KEY_ENCRYPTION_SECRET` is set only in server-side frontend/admin runtime secret storage if database-stored provider keys are managed through Conex.
- [ ] Confirm no `SUPABASE_SERVICE_ROLE_KEY`, provider key, Qdrant key, shared secret, webhook secret, or signed ticket is configured as `NEXT_PUBLIC_*`.
- [ ] Confirm `ALLOWED_ORIGINS` contains the production frontend domain and does not use `*`.
- [ ] Confirm `QDRANT_URL` is HTTPS in production or private loopback/VPN-only.
- [ ] Confirm the Supabase migrations `20260728120000_api_key_pipeline_hardening.sql`, `20260728153000_atomic_usage_accounting.sql`, `20260728154500_atomic_usage_limit_scope_fix.sql`, `20260728160000_atomic_usage_replay_guard.sql`, `20260729120000_provider_key_encryption_columns.sql`, and `20260729153000_username_uniqueness.sql` are already applied and the remote database is up to date.
- [ ] Before deploying the retention runtime code, review and apply `20260730120000_retention_production_runtime.sql` with the Supabase CLI migration workflow. This migration creates retention run/action tables, lease RPCs, retention metadata columns, and indexes; it does not delete data.
- [ ] Confirm a server-side cron/background path exists for `expire_ai_usage_reservations`; do not expose it to browser clients.
- [ ] Confirm a server-side cron/background path exists for document retention cleanup at `/api/cron/retention`; it must use a server-only cron secret and must not be callable by unauthenticated browser clients.

## 2. Restart And Redeploy Order

- [ ] Deploy/restart the frontend server after the env replacement.
- [ ] Deploy/restart the frontend server after adding or rotating `PROVIDER_KEY_ENCRYPTION_SECRET`.
- [ ] Restart the Oracle VPS gateway after the env replacement.
- [ ] Restart the RAG worker after the env replacement.
- [ ] Restart any cron/background worker process that uses Supabase admin access.
- [ ] Restart any deployment runner, queue worker, or scheduled process that caches env at process start.
- [ ] Do not disable the legacy service-role credential until all pre-disable tests pass.

## 3. Frontend And Auth Tests

- [ ] Login succeeds for a normal user.
- [ ] Email/password login succeeds, syncs the server session cookie, and redirects to the dashboard or the original safe `redirectTo` path.
- [ ] Signup succeeds and either redirects to the dashboard when email confirmation is disabled or shows a clear email-confirmation message when confirmation is enabled.
- [ ] Google sign-in returns through `/auth/callback` and then redirects to the dashboard or the original safe `redirectTo` path.
- [ ] `/login`, `/signup`, and `/auth/callback` remain public while unauthenticated; protected routes still redirect unauthenticated users to `/login`.
- [ ] Logout and login again succeeds without stale session errors.
- [ ] If Supabase `/auth/v1/user` returns 401 during bootstrap and no live/persisted session/token exists, the app transitions to unauthenticated and shows a session-expired sign-in path instead of returning to authenticated.
- [ ] Stale browser auth artifacts are cleared once without an auth loop; refresh again and confirm the dashboard/admin pages are not accessible until sign-in completes.
- [ ] Expired or invalid authenticated sessions redirect once to `/session-expired?next=<safe-local-path>`.
- [ ] The session-expired page shows `Your session has expired` and `For your security, please sign in again to renew your session.`
- [ ] `Re-authenticate` opens `/login?redirectTo=<safe-local-path>` and successful sign-in returns to the safe original page.
- [ ] Malicious or external `next`/`redirectTo` values are rejected and fall back to `/dashboard`.
- [ ] Multiple simultaneous authenticated 401 responses produce one reauthentication redirect, not a refresh storm.
- [ ] Login/signup pages remain usable while unauthenticated and while auth restore completes.
- [ ] Dashboard loads without blank screens or auth loops.
- [ ] A slow account snapshot, billing call, feature-flag call, AU initialization, or non-critical API request shows local retry/error UI and does not freeze navigation or the whole dashboard.
- [ ] Loading overlays exit on success, failure, or timeout and do not leave the page inert.
- [ ] Account snapshot loads and shows current plan/account state.
- [ ] Billing status loads and does not expose raw billing/provider config.
- [ ] Feature flags load for normal user flows.
- [ ] Old service worker cleanup works after deploy: refresh twice, close/reopen the app, and confirm protected API responses are not served from stale caches. Only unregister the service worker or clear site data manually if the new cleanup cannot recover automatically.
- [ ] AU Chat, Global Chat, Knowledge Hub, Practice Exam, Exam Prediction, and Prompt Starters do not request `/api/au/vps-ticket` while auth state is loading/restoring/unauthenticated or when `session.access_token` is missing.
- [ ] Immediately after email/password login, signup, OAuth callback, and `/session-expired` reauthentication, AU Chat can request `/api/au/vps-ticket` with the current bearer token and does not return `AUTH_REQUIRED` from a stale React session snapshot.
- [ ] Generic protected-route `401` responses, Conex/admin denials, VPS-ticket route mismatches, and provider/auth configuration failures stay endpoint-scoped and are not mislabeled as expired sessions unless the response explicitly indicates an expired or invalid Supabase session.
- [ ] If a tester lands on a stale session, sign out/sign in should recover. Manual site-data clearing is a fallback, not the first step.
- [ ] Browser console logs do not show Authorization headers, Supabase service-role/provider keys, Qdrant keys, VPS tickets, cookies, refresh tokens, or stack traces containing env data.
- [ ] Browser network responses do not include raw keys, raw provider credentials, service-role credentials, cookies, or signed tickets except the expected short-lived VPS ticket response from `/api/au/vps-ticket`.

## 3A. Username And Profile Tests

- [ ] Signup trims the requested username before submit.
- [ ] Username availability checks are case-insensitive and trim whitespace.
- [ ] Duplicate usernames are rejected by the database constraint even when casing differs.
- [ ] OAuth users without a username can complete one later through the profile username flow.
- [ ] Username/profile API responses do not expose unrelated user lists, emails, tokens, credentials, or private profile data.

## 4. Admin Panel Tests

- [ ] Admin panel loads for an authorized admin.
- [ ] Admin panel rejects a non-admin user.
- [ ] Admin user list loads from the server-admin path and is not stuck in read-only fallback mode.
- [ ] Admin create/update/delete/reset actions work only for authorized admin users.
- [ ] Provider key page lists provider status, provider name, timestamps, masked metadata, and configured/not configured state only.
- [ ] Provider key create/update accepts a new key but does not echo it back.
- [ ] Provider key create/update succeeds with `PROVIDER_KEY_ENCRYPTION_SECRET` configured and stores only encrypted credential data plus masked metadata for newly rotated rows.
- [ ] Existing database-stored provider keys have been re-entered or rotated through the admin path so legacy plaintext rows are no longer needed.
- [ ] Provider key revoke/delete does not expose the old key.
- [ ] Admin API responses do not include raw credential rows, service-role keys, provider keys, Authorization headers, cookies, refresh tokens, or signed VPS tickets.
- [ ] Admin server logs do not print raw provider errors, raw upstream responses, stack traces with env data, or secret values.

## 5. Document Upload And RAG Worker Tests

- [ ] Upload a small test document as User A.
- [ ] Upload flow shows `Policy Update: Data Security Notice` without blocking the upload UI.
- [ ] Newly uploaded Free and Promo documents show a deletion/expiry date about 14 days from upload.
- [ ] Newly uploaded paid Pro documents show a deletion/expiry date about 30 days from upload.
- [ ] Confirm upload metadata is created.
- [ ] Confirm the RAG worker claims and processes the job.
- [ ] Confirm chunk metadata is written to Supabase Postgres.
- [ ] Confirm vectors are written to Qdrant with `user_id` and `document_id` payload fields.
- [ ] Confirm the document reaches completed/ready status.
- [ ] Confirm source file cleanup runs after successful ingestion where cleanup is enabled.
- [ ] Confirm worker retry behavior is bounded and does not repeatedly download the same completed source.
- [ ] RAG worker logs do not show document text previews, Authorization headers, Supabase service-role/provider keys, Qdrant keys, cookies, refresh tokens, or raw extracted text.

## 5A. Retention Cleanup Tests

- [ ] Confirm the signup, document upload, document list/details, and settings/account surfaces show the exact `Policy Update: Data Security Notice` heading and readable policy copy.
- [ ] Call the retention cron route in dry-run/reporting mode from a server-only context; it must return counts only and must not include document names, file paths, emails, tokens, or private profile data.
- [ ] Confirm dry-run identifies documents whose owner has no verified authenticated activity for seven consecutive days.
- [ ] Confirm dry-run identifies Free and Promo documents at or after 14 days.
- [ ] Confirm dry-run identifies paid Pro documents at or after 30 days.
- [ ] Confirm the earliest applicable deadline wins when both inactivity and plan expiry apply.
- [ ] Confirm upgrading to Pro can extend unexpired documents and downgrading does not retroactively shorten an already granted later deadline.
- [ ] Execute one controlled cleanup batch against disposable test data only.
- [ ] Confirm cleanup removes the source Storage object, document metadata intended for deletion, chunks, generated document artifacts, cached previews, pending/retry work that should not continue, and Qdrant vectors for that owner/document pair.
- [ ] Confirm repeated cleanup on the same disposable document is idempotent.
- [ ] Confirm User B data is untouched when cleaning a User A document.
- [ ] Confirm failed Storage/Qdrant cleanup records bounded retry state without marking the document fully cleaned.
- [ ] Confirm unauthenticated browser calls to the cron route return 401.
- [ ] Confirm `au_retention_runs`, `au_retention_actions`, `au_runtime_leases`, `try_claim_retention_lease`, and `release_retention_lease` exist in the live schema after `20260730120000_retention_production_runtime.sql` is applied.

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
- [ ] Successful AI generation commits one usage reservation.
- [ ] Failed provider generation releases the usage reservation.
- [ ] Provider timeout releases the usage reservation.
- [ ] Retrying the same user action with the same idempotency key does not double-charge.
- [ ] Duplicate in-flight use of the same VPS ticket/idempotency key is rejected or safely deduped.

## 7. VPS Ticket And Boundary Tests

- [ ] `/health` returns only non-secret health/status metadata.
- [ ] Public chat/generation routes return 401 without a VPS ticket.
- [ ] A malformed VPS ticket is rejected.
- [ ] An expired VPS ticket is rejected.
- [ ] A tampered VPS ticket is rejected.
- [ ] A ticket issued for one route is rejected on a different route.
- [ ] A ticket issued for one feature is rejected for another feature.
- [ ] A ticket without `reservation_id` or `idempotency_key` is rejected.
- [ ] Browser-supplied `user_id`, `feature`, or `route` fields are ignored in favor of verified ticket claims.
- [ ] Browser-supplied `reservation_id` or `idempotencyKey` fields are ignored in favor of signed ticket claims.
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

## 9A. Onboarding And Mobile Install Tests

- [ ] First-time authenticated users are asked `Would you like a quick guided tour of DataCube AU?` with `Start tour`, `Maybe later`, and `Skip tour` actions.
- [ ] The tour does not auto-launch, block the app, or cover core controls on mobile.
- [ ] Completed users are not prompted again for the same onboarding version.
- [ ] Users who choose `Skip tour` are not prompted again for the same onboarding version.
- [ ] Users who choose `Maybe later` are not prompted again for at least seven days.
- [ ] Returning users with existing assistant activity are not treated as new users.
- [ ] `Help -> Take a product tour` manually starts the tour.
- [ ] Onboarding does not show while auth is restoring, expired, or on `/login`, `/signup`, `/auth/callback`, or `/session-expired`.
- [ ] At 320px, 360px, 390px, and 430px widths, the mobile PWA install control is visible when eligible and does not overlap account/menu/navigation controls.
- [ ] The install control has accessible label `Install DataCube AU`.
- [ ] Chromium install prompt opens only after a user click when `beforeinstallprompt` is available.
- [ ] iOS Safari shows `Tap Share, then Add to Home Screen.` and remembers dismissal.
- [ ] The install control hides after installation or when already running in standalone mode.

## 10. Legacy Service-Role Disable Gate

Complete this gate before disabling the legacy Supabase service-role credential:

- [ ] Frontend/server tests pass with the new `sb_secret` credential.
- [ ] Oracle VPS gateway tests pass with the new runtime environment.
- [ ] RAG worker tests pass with the new runtime environment.
- [ ] Cron/background worker tests pass if those workers use Supabase admin access.
- [ ] Admin user write actions work and do not fall back to read-only mode.
- [ ] Worker ingestion and cleanup work without service-role auth errors.
- [ ] Atomic usage reservation, commit, release, and expiry cleanup paths work without service-role auth errors.
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
