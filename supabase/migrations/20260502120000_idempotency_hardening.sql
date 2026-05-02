-- Idempotency hardening: add idempotency_key UNIQUE columns to vulnerable write tables.
-- Prevents duplicate rows under retry/offline-queue conditions.
-- 20260502120000_idempotency_hardening.sql

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. au_user_feedback — used by /api/feedback
-- ---------------------------------------------------------------------------
ALTER TABLE public.au_user_feedback
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT NULL;

-- Partial UNIQUE index (ignores legacy rows without a key)
CREATE UNIQUE INDEX IF NOT EXISTS uq_au_user_feedback_idempotency_key
  ON public.au_user_feedback(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. au_practice_attempts — used by /api/au/practice-attempts
-- ---------------------------------------------------------------------------
ALTER TABLE public.au_practice_attempts
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_au_practice_attempts_idempotency_key
  ON public.au_practice_attempts(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. au_model_usage — used by recordSyntheticUsage() in ai-governance.ts
--    Already has request_id column; add dedicated idempotency_key for clarity.
-- ---------------------------------------------------------------------------
ALTER TABLE public.au_model_usage
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_au_model_usage_idempotency_key
  ON public.au_model_usage(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. au_feedback — legacy client-side table (may not exist in all deployments)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.au_feedback') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.au_feedback ADD COLUMN IF NOT EXISTS idempotency_key TEXT NULL';
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS uq_au_feedback_idempotency_key ON public.au_feedback(idempotency_key) WHERE idempotency_key IS NOT NULL';
  END IF;
END $$;

COMMIT;
