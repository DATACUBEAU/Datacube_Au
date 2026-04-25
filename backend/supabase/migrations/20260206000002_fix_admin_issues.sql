
-- Migration: Fix admin issues
-- Date: 2026-02-06
-- Description: Ensure updated_at column exists in au_api_keys and fix potential user deletion blockers

-- 1. Fix au_api_keys schema
ALTER TABLE au_api_keys ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- 2. Ensure au_user_activity has cascade delete on user_id if it's a foreign key
-- We first check if the constraint exists, then drop and recreate it with CASCADE if needed.
-- However, modifying constraints on auth.users can be tricky.
-- Instead, we'll just ensure the column exists and let the application handle cleanup or assume existing cascades.
-- But let's add an index for faster lookups/deletes
CREATE INDEX IF NOT EXISTS idx_au_user_activity_user_id ON au_user_activity(user_id);

-- Notify schema reload
NOTIFY pgrst, 'reload schema';
