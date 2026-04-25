-- Migration: Sync API Keys and Delete Obsolete Config
-- 20260202000001_cleanup_and_sync_keys.sql

-- 1. Ensure all 5 OpenRouter keys are present in au_api_keys
-- We use 'openrouter_n' as the service name for rotation tracking
INSERT INTO au_api_keys (service, key_value, provider_type, is_active)
VALUES 
('openrouter_primary', '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', 'openrouter', true),
('openrouter_1', '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', 'openrouter', true),
('openrouter_2', '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', 'openrouter', true),
('openrouter_3', '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', 'openrouter', true),
('openrouter_4', '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', 'openrouter', true)
ON CONFLICT (service) DO UPDATE SET 
    key_value = EXCLUDED.key_value,
    is_active = true,
    provider_type = 'openrouter';

-- 2. Ensure all 5 keys are present in au_key_groups for legacy/admin-ui support
-- First, add a unique constraint if it doesn't exist to allow ON CONFLICT
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'au_key_groups_api_key_key'
    ) THEN
        ALTER TABLE au_key_groups ADD CONSTRAINT au_key_groups_api_key_key UNIQUE (api_key);
    END IF;
END
$$;

INSERT INTO au_key_groups (api_key, models, is_active)
VALUES 
('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', ARRAY['google/gemini-2.0-flash-exp:free', 'meta-llama/llama-3.3-70b-instruct:free'], true),
('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', ARRAY['google/gemini-2.0-flash-exp:free', 'meta-llama/llama-3.3-70b-instruct:free'], true),
('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', ARRAY['google/gemini-2.0-flash-exp:free', 'meta-llama/llama-3.3-70b-instruct:free'], true),
('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', ARRAY['google/gemini-2.0-flash-exp:free', 'meta-llama/llama-3.3-70b-instruct:free'], true),
('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', ARRAY['google/gemini-2.0-flash-exp:free', 'meta-llama/llama-3.3-70b-instruct:free'], true)
ON CONFLICT (api_key) DO UPDATE SET 
    is_active = true,
    models = EXCLUDED.models;

-- 3. Delete the obsolete au_openrouter_config table
-- Its functionality is now fully handled by au_models_registry
DROP TABLE IF EXISTS au_openrouter_config;

-- 4. Notify schema reload
NOTIFY pgrst, 'reload schema';
