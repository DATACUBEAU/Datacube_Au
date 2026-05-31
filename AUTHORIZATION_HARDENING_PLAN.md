# Authorization Hardening Plan

Updated: 2026-05-31

## Status

Datacube AU now uses a centralized entitlement model instead of scattered client-side checks. The source of truth is `src/lib/authz/access-control.ts`, with request enforcement in `src/lib/server/authorization.ts` and first-hop route protection in `src/middleware.ts`.

Client UI gates remain useful for navigation and upgrade flows, but they are not treated as security controls.

## Protected Route Inventory

This inventory was discovered from the `src/app` route tree, route labels, feature policies, and premium/admin keywords.

### Protected pages

| Route | Requirement | Notes |
| --- | --- | --- |
| `/dashboard` | authenticated, no-store | Dashboard shell and account-scoped state. |
| `/dashboard/chat` | authenticated, no-store | AU Chat is free with server-side quotas. VPS tickets still enforce feature and limits. |
| `/dashboard/documents` | authenticated, no-store | Document library and upload entry point. Upload limits are enforced server-side. |
| `/dashboard/global-chat` | Pro/Premium/Admin, no-store | Cross-document Global Chat. |
| `/dashboard/knowledge` | feature-gated, no-store | Document intelligence/Knowledge Hub. Free access only when policy allows it. |
| `/dashboard/practice` | Pro/Premium/Admin, no-store | Practice exam generation and attempts. |
| `/dashboard/predictions` | Pro/Premium/Admin, no-store | Exam prediction engine. |
| `/dashboard/messages` | authenticated, no-store | User-scoped messages. |
| `/dashboard/settings` | authenticated, no-store | Account settings. |
| `/dashboard/settings/subscription` | authenticated billing, no-store | Subscription and entitlement state. |
| `/conex` | Admin/Staff/Internal, no-store | Admin console. |
| `/conex/plan-limits` | Admin/Staff/Internal, no-store | Plan and quota management. |

The dashboard and Conex layouts export `dynamic = 'force-dynamic'`, `revalidate = 0`, and `fetchCache = 'force-no-store'` so protected HTML is not statically prerendered.

### Protected APIs

| Route | Requirement | Notes |
| --- | --- | --- |
| `/api/admin/*` | Admin/Staff/Internal | Admin namespace. |
| `/conex/users` | Admin/Staff/Internal | Conex user-management handler. |
| `/api/au/vps-ticket` | authenticated plus requested feature entitlement | Mints short-lived VPS tickets only after entitlement and quota checks. |
| `/api/au/document-upload` | authenticated plus upload policy | Initiate/complete upload limits enforced server-side. |
| `/api/au/practice-attempts` | Pro/Premium/Admin | Practice attempts cannot be saved by free users. |
| `/api/au/documents/*` | authenticated | User-owned document APIs. |
| `/api/au/preferences` | authenticated | User preferences. |
| `/api/feature-output` | authenticated plus feature entitlement | Knowledge, prediction, and practice output reads are no-store. |
| `/api/chat/history` | authenticated | User chat history. |
| `/api/account/*` | authenticated | Snapshot, effective state, deletion. |
| `/api/entitlements/*` | authenticated, no-store | Effective entitlement reads. |
| `/api/limits/*` | authenticated, no-store | Effective limit reads. |
| `/api/billing/cancel` | authenticated | Billing mutation. |
| `/api/billing/checkout` | authenticated | Payment/session creation. |
| `/api/billing/reconcile` | authenticated or cron secret path | Billing reconciliation. |
| `/api/billing/resubscribe` | authenticated | Billing mutation. |
| `/api/billing/status` | authenticated | Billing status. |
| `/api/payments/initialize` | authenticated | Payment initialization. |
| `/api/payments/verify` | authenticated | Payment verification. |

Billing webhooks are not user-entitlement routes; they are protected by provider signatures, rate limits, and payload validation. They are excluded from service-worker caching.

### Premium feature keys

Premium or quota-sensitive features are defined in `src/lib/tier/policy.ts`:

- `global_chat`
- `knowledge_generation`
- `practice_exam_generation`
- `exam_predictions`
- `premium_models`
- `advanced_memory`
- `priority_worker_queue`
- `document_upload`
- `prompt_starters`
- `au_chat` with server-side free quotas

## Bypass Paths Closed

- Direct URL navigation and browser history restore: middleware checks protected pages before render and redirects or 403s.
- Stale router cache and RSC prefetch: dashboard and Conex route payloads are excluded from service-worker runtime caching.
- Hidden-but-mounted premium pages: premium nav items are not rendered for unauthorized users, and server checks still protect direct access.
- Preloaded route bundles: protected App Router chunks are filtered from the generated Workbox precache manifest.
- Stale SSR/static HTML: dashboard and Conex layouts are force-dynamic/no-store.
- Premium API guessing: `/api/au/vps-ticket`, `/api/feature-output`, upload, practice, admin, billing, account, entitlement, and limit routes are in the centralized rule inventory.
- Upload bypass: upload limit failures are not swallowed; initiate/complete paths enforce limits.
- AI feature bypass: VPS tickets are minted only after feature entitlement and quota checks.
- Server action bypass: deprecated AI server actions throw and direct callers through `/api/au/vps-ticket -> VPS gateway`.
- Legacy tier bypass: legacy quota/feature bypass helpers are disabled.

## Cache Hardening

No-store headers are applied to protected middleware passes, authorization failures, entitlement APIs, billing APIs, account APIs, feature-output reads, upload APIs, and document APIs.

Service-worker hardening:

- Runtime cache version: `20260525-authz-1`.
- Warmed offline routes are public only: `/`, `/about`, `/features`, `/policy`, `/login`, `/offline`, `/~offline`, `/403`.
- Excluded cache prefixes include `/dashboard`, `/conex`, `/api/account`, `/api/admin`, `/api/au`, `/api/billing`, `/api/chat`, `/api/entitlements`, `/api/feature-output`, `/api/feedback`, `/api/limits`, and `/api/payments`.
- Warmup skips excluded paths and refuses responses with `Cache-Control: no-store`.
- Workbox precache manifest strips dashboard, Conex, and protected API route chunks.

Client cache invalidation:

- Signout, downgrade, expiration, and suspension clear user-scoped localStorage/caches.
- Feature-output in-memory cache listens for `dcau:user-scoped-caches-cleared`.
- Old PWA runtime caches are versioned and deleted on activation.

## Server/Client Trust Boundary

Server-side checks are the source of truth:

- `middleware.ts` blocks protected pages/APIs before rendering.
- Route handlers call `requireEntitlement`, `requirePaidAccess`, or `requireAdmin`.
- Layouts are dynamic/no-store for protected segments.
- Navigation rendering is only a UX layer and disables prefetch for premium paths.
- Fetch helpers may attach tokens, but do not decide entitlement.
- Supabase realtime is used only for refreshing already-authenticated client state; it is not used as an entitlement source.
- No local websocket endpoint was found. Any future realtime/websocket handler must validate a VPS ticket or call the centralized authorization utilities before joining protected channels.

## VPS Gateway Auth Pipeline

The VPS AI Gateway must verify only short-lived VPS tickets. Legacy Supabase JWT/JWKS verification symbols are absent from the local gateway runtime scan:

- `createRemoteJWKSet`
- `JWTVerifyGetKey`
- `/.well-known/jwks.json`
- `verifySupabaseToken`

Expected gateway failure text for bad tickets is `invalid_token: Invalid or expired ticket`. If production still returns the old `INVALID_OR_EXPIRED_TOKEN`/Supabase wording for `POST https://datacube-api.duckdns.org/chat/au-chat`, the live PM2 process or deployed bundle is stale.

## Required Deploy/Restart Steps

1. Redeploy the Next/Vercel frontend so middleware, dynamic layouts, route-handler enforcement, and the new service worker are live.
2. Invalidate old service-worker clients by serving the rebuilt `/sw.js` and `worker-*.js`; users with stuck old workers may need a hard refresh or service-worker unregister.
3. Redeploy the VPS AI Gateway from `vps-ai-gateway`.
4. Restart or reload the gateway PM2 process, for example `pm2 restart datacube-ai-gateway` or the actual PM2 process name on the VPS.
5. Confirm the frontend and VPS share the same `VPS_SHARED_SECRET` and gateway URL environment variables.
6. After deploy, test a free user and a Pro/Premium user against Global Chat, Knowledge, Practice, Predictions, Upload, Billing, and Conex.

## Verification

- `npm run typecheck`
- `npm run build`
- `node .tmp-tests/tests/pwa-offline.unit.test.js`
- `node .tmp-tests/tests/feature-access.unit.test.js`
- `npm run build` inside `vps-ai-gateway`

