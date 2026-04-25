-- Migration: Cleanup Free Models Registry
-- 20260209050000_cleanup_free_registry.sql

-- 1. Disable all existing free models first (safest approach)
UPDATE au_models_registry
SET is_active = false
WHERE is_free = true;

-- 2. Explicitly enable ONLY the two chosen free models
-- Chosen: Gemini Flash Lite (Fast/Smart) and Llama 3 8B (Reliable/Standard)
INSERT INTO au_models_registry (model_id, display_name, provider, context_window, is_free, is_active, type)
VALUES 
    ('google/gemini-2.0-flash-lite-preview-02-05:free', 'Gemini 2.0 Flash Lite (Free)', 'openrouter', 1000000, true, true, 'chat'),
    ('meta-llama/llama-3-8b-instruct:free', 'Llama 3 8B Instruct (Free)', 'openrouter', 8192, true, true, 'chat')
ON CONFLICT (model_id) DO UPDATE 
SET is_active = true;

-- 3. Delete any other models that are marked free but NOT in our allowlist
-- This cleans up the table permanently as requested ("just leave two")
DELETE FROM au_models_registry 
WHERE is_free = true 
AND model_id NOT IN (
    'google/gemini-2.0-flash-lite-preview-02-05:free',
    'meta-llama/llama-3-8b-instruct:free'
);

-- 4. Notify Schema Reload
NOTIFY pgrst, 'reload schema';
