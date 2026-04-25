-- Migration: User Messaging and Management Enhancements
-- 20260130000003_user_messaging_and_management.sql

-- 1. Create au_user_messages table for two-way communication
CREATE TABLE IF NOT EXISTS au_user_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    guest_session_id UUID,
    sender_type TEXT NOT NULL CHECK (sender_type IN ('admin', 'user', 'guest')),
    title TEXT,
    content TEXT NOT NULL,
    is_read BOOLEAN DEFAULT false,
    parent_id UUID REFERENCES au_user_messages(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE au_user_messages ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Admins can do everything on au_user_messages" 
ON au_user_messages FOR ALL 
TO service_role 
USING (true) 
WITH CHECK (true);

CREATE POLICY "Users can see their own messages" 
ON au_user_messages FOR SELECT 
TO authenticated 
USING (auth.uid() = user_id);

CREATE POLICY "Users can send messages" 
ON au_user_messages FOR INSERT 
TO authenticated 
WITH CHECK (auth.uid() = user_id AND sender_type = 'user');

CREATE POLICY "Guests can see their own messages" 
ON au_user_messages FOR SELECT 
TO anon 
USING (guest_session_id IS NOT NULL); -- Simplified for guest access

CREATE POLICY "Guests can send messages" 
ON au_user_messages FOR INSERT 
TO anon 
WITH CHECK (guest_session_id IS NOT NULL AND sender_type = 'guest');

-- 2. Indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_messages_user_id ON au_user_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_user_messages_guest_id ON au_user_messages(guest_session_id);
CREATE INDEX IF NOT EXISTS idx_user_messages_created_at ON au_user_messages(created_at DESC);

-- 3. Seed default embedding model to OpenRouter ADA-002
INSERT INTO au_rag_settings (key, value)
VALUES ('embedding_model', '"openai/text-embedding-ada-002"')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- 4. Notify schema reload
NOTIFY pgrst, 'reload schema';
