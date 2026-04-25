
-- Migration: Add Global Chat Maintenance Flag
-- 20260207080000_add_global_chat_flag.sql

ALTER TABLE au_conex_config
ADD COLUMN IF NOT EXISTS global_chat_enabled BOOLEAN DEFAULT true;

-- Notify schema reload
NOTIFY pgrst, 'reload schema';
