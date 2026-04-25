-- Migration: Setup Key Separation for Free/Pro Tiers
-- 20260209020000_setup_key_separation.sql

-- 1. Reset and Configure Keys based on User Specification

-- Key 1: Free Tier (openrouter_1)
-- Uses Free Models Only
UPDATE au_api_keys
SET 
    is_active = true,
    error_count = 0,
    allowed_models = ARRAY[
        'allenai/olmo-3.1-32b-think:free', 
        'google/gemini-2.0-flash-lite-preview-02-05:free',
        'meta-llama/llama-3.3-70b-instruct:free',
        'meta-llama/llama-3-8b-instruct:free',
        'mistralai/mistral-small-24b-instruct-2501:free'
    ],
    metadata = jsonb_set(metadata, '{tier}', '"free"')
WHERE service = 'openrouter_1';

-- Key 2: Pro Tier (openrouter_primary)
-- Uses Paid Models (and high-end free ones if needed, but primarily for Pro traffic)
UPDATE au_api_keys
SET 
    is_active = true,
    error_count = 0,
    allowed_models = ARRAY[
        'openai/gpt-4o',
        'anthropic/claude-3.5-sonnet',
        'google/gemini-pro-1.5',
        'meta-llama/llama-3.1-405b-instruct',
        'deepseek/deepseek-r1'
    ],
    metadata = jsonb_set(metadata, '{tier}', '"pro"')
WHERE service = 'openrouter_primary';

-- 2. Ensure Config exists
INSERT INTO au_conex_config (id, billing_enabled, paid_mode_enabled)
VALUES (1, false, false)
ON CONFLICT (id) DO NOTHING;

-- 3. Notify Schema Reload
NOTIFY pgrst, 'reload schema';
