-- Migration: Strict Key Sandboxing & Pro Registry Population
-- 20260209040000_sandbox_keys.sql

-- 1. Enforce Metadata Tags for Strict Sandboxing
UPDATE au_api_keys
SET metadata = jsonb_set(metadata, '{tier}', '"pro"')
WHERE service = 'openrouter_primary';

UPDATE au_api_keys
SET metadata = jsonb_set(metadata, '{tier}', '"free"')
WHERE service = 'openrouter_1';

-- 2. Ensure Pro Registry is Populated (Idempotent)
INSERT INTO au_pro_models_registry (model_id, display_name, provider, context_window, capabilities, size_class, is_active)
VALUES 
    ('openai/gpt-5-nano', 'GPT-5 Nano', 'openrouter', 128000, ARRAY['chat', 'fast_response'], 'small', true),
    ('google/gemini-2.5-flash-lite-preview-09-2025', 'Gemini 2.5 Flash Lite', 'openrouter', 1000000, ARRAY['chat', 'reasoning', 'long_context'], 'large', true)
ON CONFLICT (model_id) DO UPDATE 
SET 
    is_active = true,
    capabilities = EXCLUDED.capabilities,
    size_class = EXCLUDED.size_class;

-- 3. Add a check constraint to prevent accidental cross-tier usage?
-- Hard to do on API keys table without schema change, but we can verify consistency.

-- 4. Notify Schema Reload
NOTIFY pgrst, 'reload schema';
