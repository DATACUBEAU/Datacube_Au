-- Migration: Final Schema Cleanup & Neat Formation
-- 20260202000002_final_cleanup.sql

-- 1. Delete redundant tables that have been superseded by au_models_registry and au_api_keys
DROP TABLE IF EXISTS au_openrouter_config CASCADE;
DROP TABLE IF EXISTS au_key_groups CASCADE;

-- 2. Ensure au_api_keys has a clean structure for the "Brain"
-- We already enhanced it in previous migrations, but let's ensure the indices are perfect
CREATE INDEX IF NOT EXISTS idx_au_api_keys_provider_active ON au_api_keys(provider_type, is_active);
CREATE INDEX IF NOT EXISTS idx_au_api_keys_rotation ON au_api_keys(last_used_at ASC NULLS FIRST);

-- 3. Ensure au_models_registry is indexed for fast lookups
CREATE INDEX IF NOT EXISTS idx_au_models_registry_active_type ON au_models_registry(type, is_active);

-- 4. Final sync of RAG settings to ensure "Neat Formation"
INSERT INTO au_rag_settings (key, value, description)
VALUES 
('system_status', '"operational"', 'Overall status of the AI Brain'),
('last_audit_at', '"2026-02-02T00:00:00Z"', 'Timestamp of the last comprehensive configuration audit')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- 5. Notify schema reload to ensure the changes take effect in PostgREST
NOTIFY pgrst, 'reload schema';
