# DataCube AU Next Critical Sprint

Last updated: 2026-07-29

## Recommendation

The previously recommended must-fix sprint, **Atomic Usage Accounting and Cost-Control Hardening**, has now been implemented in code and migration files.

This remains the reference design for the implemented reserve -> begin -> commit/release lifecycle. The remaining readiness work is live Oracle VPS/frontend/RAG verification, scheduling expired reservation cleanup, and provider cost monitoring.

## Why This Is Next

- Usage is checked before issuing a VPS ticket, but provider success/failure is not yet part of a single atomic lifecycle.
- Failed generations can still create billing/support disputes if usage is consumed before the provider succeeds.
- Retries, browser reconnects, and duplicate requests need idempotency so one user action cannot double-charge.
- Plan limits must remain enforceable under concurrent requests.
- Provider timeouts and fallback behavior must have explicit cost policy.

## Required Design

Use a server-owned usage reservation lifecycle:

1. The frontend sends an idempotency key with each AI request.
2. Next.js validates auth, feature entitlement, plan limits, and rate limits.
3. A concurrency-safe SQL/RPC function reserves usage before issuing a VPS ticket.
4. The VPS ticket carries the reservation ID and idempotency key in its claims.
5. The VPS gateway performs generation with timeout and provider-fallback controls.
6. Next.js or the gateway commits usage only after successful provider generation.
7. Failed generation rolls back or releases the reservation according to explicit policy.
8. Expired reservations are cleaned by scheduled cleanup.
9. Repeated requests with the same idempotency key return the same reservation/result state instead of charging again.

## Reservation Model

Recommended reservation states:

- `reserved`: request accepted, quota held, provider call not yet complete.
- `committed`: provider generation succeeded and usage is billable.
- `released`: provider generation failed or was safely abandoned.
- `expired`: reservation timed out without completion and was released by cleanup.
- `disputed`: manual review state for ambiguous provider/network outcomes.

Recommended fields:

- `id`
- `user_id`
- `feature_key`
- `route`
- `idempotency_key`
- `request_fingerprint`
- `estimated_units`
- `reserved_units`
- `committed_units`
- `status`
- `provider`
- `model`
- `ticket_id`
- `created_at`
- `expires_at`
- `committed_at`
- `released_at`
- `failure_code`

## RPC And SQL Requirements

- Reserve usage in a single transaction.
- Lock the user's relevant usage/plan counter row before checking and updating quota.
- Enforce uniqueness on `(user_id, feature_key, idempotency_key)`.
- Return the existing reservation for duplicate idempotency keys.
- Prevent reserve if the plan limit would be exceeded.
- Commit only a valid `reserved` reservation.
- Release only a valid `reserved` reservation.
- Make commit/release idempotent.
- Keep service-role/server-only access to reservation mutations.
- Add cleanup for expired reservations.

## Policy Decisions To Make

- Failed provider request policy: decide which failures are free, retryable, or billable.
- Timeout policy: decide whether provider timeout releases usage or creates `disputed`.
- Fallback policy: decide whether multiple provider attempts still count as one user request.
- Streaming policy: decide when streamed output becomes billable.
- Retry policy: decide how long idempotency keys remain valid.
- Abuse policy: decide how rate limits interact with repeated failed reservations.

## Integration Points

- `/api/au/vps-ticket`: reserve before issuing a ticket.
- VPS AI Gateway: include reservation metadata in request handling and response status.
- Provider router: report success/failure/timeout/fallback outcome without leaking provider details.
- Usage tracking: commit/release via server-only RPC.
- Billing/entitlements: enforce plan limits against reserved plus committed usage.
- Rate limiting: count request attempts separately from billable usage.
- Observability: log request IDs, reservation IDs, feature, route, provider status, and redacted error codes only.

## Test Plan

- Concurrent requests from the same user cannot exceed plan limits.
- Concurrent requests with the same idempotency key do not double-charge.
- Failed generation does not overcharge.
- Provider timeout releases or disputes usage according to policy.
- Provider fallback does not double-charge one user action.
- Browser reconnect/retry does not create duplicate committed usage.
- Expired reservations are cleaned and quota is released.
- Limit bypass attempts by changing feature/route/body fields fail.
- Reservation IDs in VPS tickets are route-bound and feature-bound.
- Non-owner users cannot reserve, commit, release, or inspect another user's usage.
- Admin reports reflect reserved, committed, released, expired, and disputed usage correctly.

## Acceptance Criteria

- Usage reserve, commit, release, and cleanup are implemented as migration-backed SQL/RPC.
- API and gateway code use idempotency keys end to end.
- Focused concurrency tests pass.
- Failed generation and retry tests prove no double-charge.
- Plan-limit bypass tests prove limits hold under race conditions.
- Logs contain no secrets, provider keys, Authorization headers, cookies, refresh tokens, or signed VPS tickets.

## Status

Implemented and locally verified. Keep this Yellow for deployment readiness until Oracle VPS live retry/reconnect tests, expired reservation cleanup scheduling, and provider cost monitoring pass.
