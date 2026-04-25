-- Migration: Enable P2P Messaging and Unread Counts
-- 20260209000000_enable_p2p_messaging.sql

-- 1. Add sender/receiver columns for P2P
ALTER TABLE au_user_messages 
ADD COLUMN IF NOT EXISTS sender_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS receiver_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- 2. Backfill existing data (User <-> Admin Support Chat)
-- Case 1: User sent to Admin
UPDATE au_user_messages 
SET sender_id = user_id 
WHERE sender_type = 'user' AND sender_id IS NULL;

-- Case 2: Admin sent to User
UPDATE au_user_messages 
SET receiver_id = user_id 
WHERE sender_type = 'admin' AND receiver_id IS NULL;

-- 3. Update RLS Policies

-- Drop old restrictive policies (conflicting with P2P)
DROP POLICY IF EXISTS "Users can send messages" ON au_user_messages;
DROP POLICY IF EXISTS "Users can see their own messages" ON au_user_messages;

-- Policy: Users can INSERT if they are the Sender
CREATE POLICY "Users can insert as sender" ON au_user_messages
FOR INSERT TO authenticated
WITH CHECK (
    auth.uid() = sender_id
);

-- Policy: Users can SELECT if they are Sender OR Receiver
CREATE POLICY "Users can view own threads" ON au_user_messages
FOR SELECT TO authenticated
USING (
    auth.uid() = sender_id OR 
    auth.uid() = receiver_id OR
    -- Keep legacy support for existing 'user_id' based queries if needed, 
    -- but preferably we migrate to sender/receiver.
    -- For safety, we include the old check too:
    auth.uid() = user_id
);

-- 4. Unread Count Function
CREATE OR REPLACE FUNCTION get_unread_count(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_count INTEGER;
BEGIN
    SELECT count(*)
    INTO v_count
    FROM public.au_user_messages
    WHERE 
        receiver_id = p_user_id 
        AND is_read = false;
        
    RETURN v_count;
END;
$$;

-- Grant access to the function
GRANT EXECUTE ON FUNCTION get_unread_count(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_unread_count(UUID) TO service_role;

-- 5. Mark Thread Read Function
CREATE OR REPLACE FUNCTION mark_thread_read(p_user_id UUID, p_other_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    UPDATE public.au_user_messages
    SET is_read = true
    WHERE 
        receiver_id = p_user_id 
        AND sender_id = p_other_user_id
        AND is_read = false;
END;
$$;

GRANT EXECUTE ON FUNCTION mark_thread_read(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION mark_thread_read(UUID, UUID) TO service_role;

-- 6. Notify schema reload
NOTIFY pgrst, 'reload schema';
