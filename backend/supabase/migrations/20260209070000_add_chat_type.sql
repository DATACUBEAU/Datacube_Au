-- Migration: Add Chat Type for Strict Isolation
-- 20260209070000_add_chat_type.sql

-- 1. Create Enum
CREATE TYPE chat_type_enum AS ENUM ('au_rag', 'global');

-- 2. Add chat_type to au_sessions (Threads)
ALTER TABLE au_sessions 
ADD COLUMN IF NOT EXISTS chat_type chat_type_enum NOT NULL DEFAULT 'au_rag';

-- 3. Create Index for Performance
CREATE INDEX IF NOT EXISTS idx_au_sessions_chat_type ON au_sessions(chat_type);

-- 4. Update RLS Policies for Isolation
-- Ensure Users can only see their own threads (already exists via owner_id/guest_session_id)
-- But let's reinforce it and ensure type separation if needed.
-- Existing policies usually check owner_id = auth.uid(). This is sufficient for isolation between users.
-- For "Global Chat cannot read AU Chat", that's an application-level concern (Edge Function logic),
-- but we can ensure the database supports distinguishing them.

-- 5. Add chat_type to au_messages? 
-- Not strictly necessary if messages are always accessed via session_id.
-- But let's keep it simple and rely on the join if needed.

-- 6. Notify Schema Reload
NOTIFY pgrst, 'reload schema';
