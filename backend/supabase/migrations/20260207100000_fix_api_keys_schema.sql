-- Fix au_api_keys schema to match user requirements
-- Timestamp: 20260207100000

-- 1. Add missing updated_at column
ALTER TABLE public.au_api_keys 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 2. Create requested indexes
CREATE INDEX IF NOT EXISTS idx_au_api_keys_provider_active 
ON public.au_api_keys USING btree (provider_type, is_active);

CREATE INDEX IF NOT EXISTS idx_au_api_keys_rotation 
ON public.au_api_keys USING btree (last_used_at NULLS FIRST);

-- 3. Ensure columns exist (idempotent checks)
ALTER TABLE public.au_api_keys 
ADD COLUMN IF NOT EXISTS provider_type TEXT DEFAULT 'openrouter'::text,
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS allowed_models TEXT[];

-- 4. Notify schema reload
NOTIFY pgrst, 'reload schema';
