# Datacube AU Flags + Limits Guide

## Mount points
- `FeatureFlagProvider` is mounted in `src/app/layout.tsx`.
- `LimitsProvider` is mounted in `src/app/layout.tsx`, inside `FeatureFlagProvider` and above app pages/components.

## Add a new feature flag
1. Add the flag seed to migration `20260226134000_feature_flags_limits_system.sql` (`public.feature_flags` insert block).
2. Give it a stable key (for example `limits.chat.smart_retry.enabled`) and optional JSON config.
3. Read it via `useFlag('limits.chat.smart_retry.enabled')` or `useFeatureFlags()` in frontend.
4. For admin toggles, use `setFlag(key, enabled)` (optimistic + realtime sync already wired).

## Add a new limit
1. Add the key in `public.plan_limits.limits` JSON for each plan.
2. Enforce it server-side in edge functions/worker using:
   - `getEffectiveLimitsForUser(...)`
   - `readLimit(...)`
   - `enforceLimitOrThrow(...)`
3. Increment authoritative usage counters with `increment_usage_counters` RPC from server/worker code.
4. Add a client rule in `src/lib/limits/limitations-agent.ts` to surface context-aware alerts.

## Current enforcement points
- Upload registration/completion: `backend/supabase/functions/document-upload/index.ts`
- AU chat: `backend/supabase/functions/au-chat/index.ts`
- Worker accounting for ingestion outcomes: `rag-worker/src/worker.ts`, `backend/rag-worker/src/worker.ts`

## Why enforcement is server-side
- Client checks can be bypassed.
- Centralized server checks keep plan/limit behavior consistent across frontend, edge functions, and worker pipeline.
- Structured errors (`LIMIT_EXCEEDED`) allow instant UX feedback while preserving authoritative control.
