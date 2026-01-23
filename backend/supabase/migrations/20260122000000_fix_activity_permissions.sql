
-- Grant permissions on au_user_activity to all roles
GRANT ALL ON TABLE au_user_activity TO anon, authenticated, service_role;

-- Ensure RLS is enabled
ALTER TABLE au_user_activity ENABLE ROW LEVEL SECURITY;

-- Re-create policies if they are missing (idempotent)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'au_user_activity' AND policyname = 'Users can view own activity'
    ) THEN
        CREATE POLICY "Users can view own activity" ON au_user_activity
          FOR SELECT USING (auth.uid() = user_id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'au_user_activity' AND policyname = 'Users can insert own activity'
    ) THEN
        CREATE POLICY "Users can insert own activity" ON au_user_activity
          FOR INSERT WITH CHECK (auth.uid() = user_id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'au_user_activity' AND policyname = 'Users can update own activity'
    ) THEN
        CREATE POLICY "Users can update own activity" ON au_user_activity
          FOR UPDATE USING (auth.uid() = user_id)
          WITH CHECK (auth.uid() = user_id);
    END IF;
END
$$;

-- Force schema cache reload
NOTIFY pgrst, 'reload config';
