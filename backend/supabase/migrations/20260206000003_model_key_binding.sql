-- Migration: Add allowed_models to au_api_keys
-- 20260206000000_model_key_binding.sql

-- 1. Add allowed_models column to au_api_keys
ALTER TABLE au_api_keys ADD COLUMN IF NOT EXISTS allowed_models TEXT[] DEFAULT NULL;

-- 2. Notify schema reload
NOTIFY pgrst, 'reload schema';
