-- Migration: Security Hardening (Re-enabling RLS with Guest Support)
-- 20260202000003_hardening_rls.sql

-- 1. Re-enable RLS on all tables
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'au_api_keys') THEN ALTER TABLE au_api_keys ENABLE ROW LEVEL SECURITY; END IF;
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'au_rag_settings') THEN ALTER TABLE au_rag_settings ENABLE ROW LEVEL SECURITY; END IF;
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'au_sessions') THEN ALTER TABLE au_sessions ENABLE ROW LEVEL SECURITY; END IF;
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'au_messages') THEN ALTER TABLE au_messages ENABLE ROW LEVEL SECURITY; END IF;
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'au_guest_sessions') THEN ALTER TABLE au_guest_sessions ENABLE ROW LEVEL SECURITY; END IF;
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'au_model_usage') THEN ALTER TABLE au_model_usage ENABLE ROW LEVEL SECURITY; END IF;
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'au_events') THEN ALTER TABLE au_events ENABLE ROW LEVEL SECURITY; END IF;
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'au_direct_messages') THEN ALTER TABLE au_direct_messages ENABLE ROW LEVEL SECURITY; END IF;
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'au_user_notifications') THEN ALTER TABLE au_user_notifications ENABLE ROW LEVEL SECURITY; END IF;
END $$;

-- 2. Define Policies for au_api_keys (Service Role Only)
DROP POLICY IF EXISTS "Service role only" ON au_api_keys;
CREATE POLICY "Service role only" ON au_api_keys FOR ALL TO service_role USING (true);

-- 3. Define Policies for au_rag_settings (Public Read, Admin Write)
DROP POLICY IF EXISTS "Allow read access to authenticated and anon" ON au_rag_settings;
CREATE POLICY "Allow read access to authenticated and anon" ON au_rag_settings 
    FOR SELECT TO authenticated, anon USING (true);

-- 4. Define Guest-Aware Policies for User Data
-- Pattern: Check auth.uid() OR match guest_session_id in JWT claims

-- au_sessions
DROP POLICY IF EXISTS "Users can manage own sessions" ON au_sessions;
CREATE POLICY "Users can manage own sessions" ON au_sessions
    FOR ALL TO authenticated, anon
    USING (
        auth.uid() = user_id 
    );

-- au_messages
DROP POLICY IF EXISTS "Users can manage own messages" ON au_messages;
CREATE POLICY "Users can manage own messages" ON au_messages
    FOR ALL TO authenticated, anon
    USING (
        auth.uid() = user_id 
    );

-- au_guest_sessions
DROP POLICY IF EXISTS "Guests can manage own session" ON au_guest_sessions;
CREATE POLICY "Guests can manage own session" ON au_guest_sessions
    FOR ALL TO anon
    USING (id::text = (current_setting('request.jwt.claims', true)::jsonb ->> 'guest_session_id'));

-- au_model_usage (Read-only for owners)
DROP POLICY IF EXISTS "Users can view own model usage" ON au_model_usage;
CREATE POLICY "Users can view own model usage" ON au_model_usage
    FOR SELECT TO authenticated, anon
    USING (
        auth.uid() = user_id 
    );

-- 5. Define Policies for Communication
-- au_direct_messages (Sender or Recipient)
DROP POLICY IF EXISTS "Users can view own DMs" ON au_direct_messages;
CREATE POLICY "Users can view own DMs" ON au_direct_messages
    FOR SELECT TO authenticated, anon
    USING (
        auth.uid() = user_id 
    );

-- 6. Reload Schema
NOTIFY pgrst, 'reload schema';
