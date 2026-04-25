
-- Force schema cache reload to fix "Could not find column" error
NOTIFY pgrst, 'reload schema';

-- Ensure updated_at column exists on au_api_keys just in case
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'au_api_keys' AND column_name = 'updated_at') THEN
        ALTER TABLE au_api_keys ADD COLUMN updated_at TIMESTAMPTZ DEFAULT now();
    END IF;
END $$;
