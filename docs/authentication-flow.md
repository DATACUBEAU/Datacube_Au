# Authentication Flow

## Overview

Protected Datacube AU requests use one client-to-server contract:

1. `useSmartAuth` restores the browser session from Supabase and persisted storage.
2. `resolveBrowserSession()` in [src/lib/supabase-client/client.ts] centralizes live-session lookup, persisted-session fallback, proactive refresh, and server-cookie sync.
3. `fetchEdgeFunctionResponse()` uses the resolved access token for `/api/proxy/[functionName]` requests and retries once after a forced refresh when a `401` is returned.
4. `/api/proxy/[functionName]` validates auth with `requireUserFromRequest()` and forwards the validated bearer token to the Supabase Edge Function.
5. Edge Functions validate the forwarded `Authorization` header with Supabase Auth.

## Root Cause

The chat `401` loop came from auth recovery being split across multiple places:

- `useSmartAuth` restored sessions with its own `getSession()/refreshSession()` path.
- `fetchEdgeFunctionResponse()` used a separate refresh path.
- A request could hit `/api/proxy/au-chat` with a stale or near-expiry token before the provider-side restore finished.
- That endpoint-level `401` could then promote the whole runtime state to `EXPIRED`, even though the session was still recoverable moments later.

## Current Strategy

### Session restore and refresh

- `normalizeUsableSupabaseSession()` rejects already-expired sessions.
- `shouldRefreshSupabaseSession()` starts a proactive refresh when a session is inside the 60 second refresh window.
- `refreshBrowserSession()` is single-flight so concurrent protected requests share one refresh attempt.
- `resolveBrowserSession()` is the canonical resolver used by both `useSmartAuth` and protected request helpers.

### Request auth propagation

- Client requests send `credentials: 'include'`.
- When an access token is available, the client also sends `Authorization: Bearer <token>`.
- The proxy now prefers the explicit `Authorization` header over cookies.
- The proxy exposes auth diagnostics in `401` responses with:
  - `x-dcau-auth-stage`
  - `x-dcau-auth-reason`
  - `x-dcau-auth-has-authorization`
  - `x-dcau-auth-has-cookie`

### 401 handling

- A recoverable `401` moves the runtime into `RESTORING`, not immediately `EXPIRED`.
- The client forces one shared refresh, retries the request with the recovered token, and only dispatches session expiry when refresh is conclusively not recoverable.
- Endpoint-scoped `401`s from the edge function do not poison the whole app session.

## Manual Debugging

If `au-chat` still returns `401`, inspect:

1. The `/api/proxy/au-chat` response headers for the `x-dcau-auth-*` diagnostics.
2. The browser console log from `fetchEdgeFunctionResponse()` showing:
   - `authStage`
   - `reason`
   - `hasAuthorizationHeader`
   - `hasAuthCookie`
   - `attemptedSources`
   - `validatedSource`
3. Whether `resolveBrowserSession()` reports `source: 'refreshed'` or falls back to `persisted`.

If the proxy reports `proxy_gate` with `missing_token` or `invalid_token`, the failure is in browser session restore/cookie/token sync.
If the proxy reports `edge_function`, the proxy auth succeeded and the forwarded bearer token was rejected downstream.
