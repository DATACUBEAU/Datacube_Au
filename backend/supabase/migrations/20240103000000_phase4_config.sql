-- Phase 4 Schema Update: API Keys and Model Configuration

-- 1. Create table for secure API keys (if not exists)
CREATE TABLE IF NOT EXISTS au_api_keys (
  service TEXT PRIMARY KEY,
  key_value TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE au_api_keys ENABLE ROW LEVEL SECURITY;

-- Only service_role can read/write keys (Edge Functions use service_role)
CREATE POLICY "No access for public" ON au_api_keys
  FOR ALL USING (false);

-- 3. Configure Approved Models in au_openrouter_config
-- Clear existing config to ensure compliance
DELETE FROM au_openrouter_config;

INSERT INTO au_openrouter_config (model_id, is_active, parameters) VALUES
('allenai/olmo-3.1-32b-think:free', true, '{"temperature": 0.7}'::jsonb),
('nvidia/nemotron-3-nano-30b-a3b:free', true, '{"temperature": 0.7}'::jsonb),
('mistralai/devstral-2512:free', true, '{"temperature": 0.7}'::jsonb);

-- 4. Set default model setting in au_rag_settings (if not exists)
INSERT INTO au_rag_settings (key, value, description)
VALUES ('default_model', '"google/gemini-2.0-flash-exp:free"', 'Default model for AU')
ON CONFLICT (key) DO UPDATE SET value = '"google/gemini-2.0-flash-exp:free"';

-- NOTE: The prompt asked for specific models. We should probably update the default to one of them.
-- Updating default to Olmo as primary free thinking model.
UPDATE au_rag_settings 
SET value = '"allenai/olmo-3.1-32b-think:free"' 
WHERE key = 'default_model';
