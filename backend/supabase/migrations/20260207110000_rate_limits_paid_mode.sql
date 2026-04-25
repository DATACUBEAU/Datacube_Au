-- Rate Limiting & Paid Mode Configuration
-- Timestamp: 20260207110000

-- 1. Create Generic Rate Limits Table (for AU Answer / Chat)
CREATE TABLE IF NOT EXISTS public.au_rate_limits (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    identifier TEXT NOT NULL, -- IP or User ID
    endpoint TEXT NOT NULL DEFAULT 'chat', -- 'chat', 'embedding', etc.
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast cleanup and counting
CREATE INDEX IF NOT EXISTS idx_au_rate_limits_check 
ON public.au_rate_limits USING btree (identifier, endpoint, created_at);

-- 2. Add 'paid_mode_enabled' to Conex Config
ALTER TABLE public.au_conex_config
ADD COLUMN IF NOT EXISTS paid_mode_enabled BOOLEAN DEFAULT FALSE;

-- 3. Notify Schema Reload
NOTIFY pgrst, 'reload schema';
