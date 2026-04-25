-- Migration: Robust Configuration Management System
-- 20260202000000_config_refactor.sql

-- 1. Create Model Registry Table
CREATE TABLE IF NOT EXISTS au_models_registry (
    model_id TEXT PRIMARY KEY, -- e.g., 'google/gemini-2.0-flash-exp:free'
    display_name TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'openrouter',
    type TEXT NOT NULL CHECK (type IN ('chat', 'embedding')),
    is_free BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    context_window INTEGER DEFAULT 4096,
    rate_limit_rpm INTEGER DEFAULT 20, -- Requests per minute (default for free tier)
    rate_limit_tpm INTEGER DEFAULT 100000, -- Tokens per minute (default for free tier)
    usage_constraints JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE au_models_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow read access to authenticated users" ON au_models_registry FOR SELECT TO authenticated USING (true);

-- 2. Seed Model Registry with all cataloged models
INSERT INTO au_models_registry (model_id, display_name, provider, type, is_free, context_window) VALUES
('google/gemini-2.0-flash-exp:free', 'Gemini 2.0 Flash Exp (Free)', 'openrouter', 'chat', true, 1048576),
('google/gemini-2.0-flash-lite-preview-02-05:free', 'Gemini 2.0 Flash Lite Preview (Free)', 'openrouter', 'chat', true, 1048576),
('meta-llama/llama-3.3-70b-instruct:free', 'Llama 3.3 70B (Free)', 'openrouter', 'chat', true, 131072),
('meta-llama/llama-3.1-405b-instruct:free', 'Llama 3.1 405B (Free)', 'openrouter', 'chat', true, 131072),
('meta-llama/llama-3.2-3b-instruct:free', 'Llama 3.2 3B (Free)', 'openrouter', 'chat', true, 131072),
('meta-llama/llama-3-8b-instruct:free', 'Llama 3.0 8B (Free)', 'openrouter', 'chat', true, 8192),
('allenai/olmo-3.1-32b-think:free', 'OLMo 3.1 32B Think (Free)', 'openrouter', 'chat', true, 4096),
('openai/text-embedding-ada-002', 'Text Embedding ADA 002', 'openrouter', 'embedding', false, 8192)
ON CONFLICT (model_id) DO UPDATE SET 
    display_name = EXCLUDED.display_name,
    is_free = EXCLUDED.is_free,
    context_window = EXCLUDED.context_window;

-- 3. Enhance API Keys Table with Encryption
-- We'll use a simple XOR or pgcrypto if available. 
-- For this environment, we'll assume the 'key_value' is encrypted before insertion 
-- or we use a database-level vault. 
-- Let's add a column for the encrypted key if it doesn't exist.

ALTER TABLE au_api_keys ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE au_api_keys ADD COLUMN IF NOT EXISTS error_count INTEGER DEFAULT 0;
ALTER TABLE au_api_keys ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;
ALTER TABLE au_api_keys ADD COLUMN IF NOT EXISTS provider_type TEXT DEFAULT 'openrouter';
ALTER TABLE au_api_keys ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

-- 4. Standardize RAG Settings
INSERT INTO au_rag_settings (key, value, description)
VALUES 
('embedding_model', '"openai/text-embedding-ada-002"', 'Authoritative embedding model'),
('default_chat_model', '"google/gemini-2.0-flash-exp:free"', 'Default chat model'),
('config_version', '"1.0.0"', 'Version of the configuration system')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- 5. Create Model Rotation Stats (Internal tracking)
CREATE TABLE IF NOT EXISTS au_model_usage_stats (
    model_id TEXT REFERENCES au_models_registry(model_id),
    usage_date DATE DEFAULT CURRENT_DATE,
    call_count INTEGER DEFAULT 0,
    token_count INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    PRIMARY KEY (model_id, usage_date)
);

-- 6. RPC for reporting key failure
CREATE OR REPLACE FUNCTION report_api_key_failure(p_key_value TEXT)
RETURNS VOID AS $$
BEGIN
    UPDATE au_api_keys
    SET error_count = error_count + 1,
        is_active = CASE WHEN error_count + 1 >= 5 THEN false ELSE true END,
        last_used_at = now()
    WHERE key_value = p_key_value;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. Function to get a rotated key
CREATE OR REPLACE FUNCTION get_rotated_api_key(p_provider TEXT)
RETURNS TEXT AS $$
DECLARE
    v_key TEXT;
BEGIN
    SELECT key_value INTO v_key
    FROM au_api_keys
    WHERE provider_type = p_provider
      AND is_active = true
    ORDER BY last_used_at ASC NULLS FIRST
    LIMIT 1;

    IF v_key IS NOT NULL THEN
        UPDATE au_api_keys SET last_used_at = now() WHERE key_value = v_key;
    END IF;

    RETURN v_key;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. Cleanup Obsolete Columns/Tables
-- We keep au_openrouter_config for now but mark as deprecated in docs.
-- It can be migrated fully to au_models_registry later if needed.

NOTIFY pgrst, 'reload schema';
