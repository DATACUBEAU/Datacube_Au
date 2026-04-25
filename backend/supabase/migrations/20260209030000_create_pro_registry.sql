-- Migration: Create Pro Models Registry and New Logic
-- 20260209030000_create_pro_registry.sql

-- 1. Create the new Pro Models Registry
CREATE TABLE IF NOT EXISTS au_pro_models_registry (
    model_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'openrouter',
    context_window INTEGER DEFAULT 128000,
    capabilities TEXT[] DEFAULT ARRAY['chat'], -- e.g. ['chat', 'coding', 'reasoning']
    size_class TEXT DEFAULT 'large', -- 'small', 'medium', 'large'
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Populate with specific Pro models requested
INSERT INTO au_pro_models_registry (model_id, display_name, provider, context_window, capabilities, size_class)
VALUES 
    ('openai/gpt-5-nano', 'GPT-5 Nano', 'openrouter', 128000, ARRAY['chat', 'fast_response'], 'small'),
    ('google/gemini-2.5-flash-lite-preview-09-2025', 'Gemini 2.5 Flash Lite', 'openrouter', 1000000, ARRAY['chat', 'reasoning', 'long_context'], 'large')
ON CONFLICT (model_id) DO UPDATE 
SET 
    is_active = true,
    capabilities = EXCLUDED.capabilities,
    size_class = EXCLUDED.size_class;

-- 3. Grant permissions
GRANT SELECT ON au_pro_models_registry TO authenticated;
GRANT SELECT ON au_pro_models_registry TO service_role;

-- 4. Notify Schema Reload
NOTIFY pgrst, 'reload schema';
