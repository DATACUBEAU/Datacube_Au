-- Migration: Align Pro Models Registry Schema & Permissions
-- 20260209060000_align_pro_registry.sql

-- 1. Ensure Schema Parity with au_models_registry
-- We need to ensure columns match exactly: 
-- model_id, display_name, provider, type, context_window, is_free, is_active, 
-- rate_limit_rpm, rate_limit_tpm, usage_constraints, created_at, updated_at
-- (capabilities and size_class are extra in Pro, but that's fine, we just need the basics)

ALTER TABLE au_pro_models_registry 
ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'chat',
ADD COLUMN IF NOT EXISTS is_free BOOLEAN DEFAULT false, -- Always false for Pro
ADD COLUMN IF NOT EXISTS rate_limit_rpm INTEGER DEFAULT 60,
ADD COLUMN IF NOT EXISTS rate_limit_tpm INTEGER DEFAULT 100000,
ADD COLUMN IF NOT EXISTS usage_constraints JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- 2. Indexes for Performance (Mirroring Free Registry)
CREATE INDEX IF NOT EXISTS idx_au_pro_models_registry_active ON au_pro_models_registry(is_active);
CREATE INDEX IF NOT EXISTS idx_au_pro_models_registry_provider ON au_pro_models_registry(provider);

-- 3. Strict Permissions (Sandboxing)
-- Revoke Public Access just in case
REVOKE ALL ON au_pro_models_registry FROM anon, authenticated;

-- Allow Service Role (Admin/Edge Functions) Full Access
GRANT ALL ON au_pro_models_registry TO service_role;

-- Allow Authenticated Users SELECT ONLY (if needed for UI, but task says "No public/user direct read unless allowed")
-- Actually, the task says "Both tables readable ONLY by service_role/admin paths used by Conex."
-- So we should NOT grant to authenticated generally, only via RPC/Edge Function.
-- But wait, Conex is admin panel.
-- Let's stick to Service Role only.
-- The previous migration might have granted SELECT to authenticated. Let's REVOKE it to be safe.
REVOKE SELECT ON au_pro_models_registry FROM authenticated;

-- 4. Notify Schema Reload
NOTIFY pgrst, 'reload schema';
