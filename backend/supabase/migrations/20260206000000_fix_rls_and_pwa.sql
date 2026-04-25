
-- Migration: Fix RLS and PWA issues
-- Date: 2026-02-06
-- Description: Harden RLS for user messages and activity

-- 1. Fix au_user_messages RLS for guests
-- Guests should only be able to see their own messages (linked by guest_session_id)
DROP POLICY IF EXISTS "Guests can view their own messages" ON au_user_messages;
CREATE POLICY "Guests can view their own messages"
ON au_user_messages
FOR SELECT
USING (
  guest_session_id IS NOT NULL AND
  (
    -- Check if the request has a guest_session_id claim (custom auth)
    (auth.jwt() ->> 'guest_session_id')::uuid = guest_session_id
    OR
    -- OR if it's an authenticated user (admin fallback)
    auth.role() = 'service_role'
  )
);

DROP POLICY IF EXISTS "Guests can insert their own messages" ON au_user_messages;
CREATE POLICY "Guests can insert their own messages"
ON au_user_messages
FOR INSERT
WITH CHECK (
  guest_session_id IS NOT NULL AND
  (auth.jwt() ->> 'guest_session_id')::uuid = guest_session_id
);

-- 2. Ensure au_user_activity allows guests to update their own activity
-- This is crucial for the "last_active_at" heartbeat
DROP POLICY IF EXISTS "Guests can update their own activity" ON au_user_activity;
-- Note: au_user_activity uses user_id (UUID). For guests, we might not be using this table directly 
-- or we map guest_id to user_id. 
-- If guests use au_guest_sessions instead, let's ensure that table is writable.

DROP POLICY IF EXISTS "Guests can update their own session" ON au_guest_sessions;
CREATE POLICY "Guests can update their own session"
ON au_guest_sessions
FOR UPDATE
USING (
  id = (auth.jwt() ->> 'guest_session_id')::uuid
);

-- 3. Fix 406 Not Acceptable by ensuring RLS doesn't block "select single" on empty
-- (This is handled by the frontend .maybeSingle() change, but good to have loose RLS for read)

-- Notify schema reload
NOTIFY pgrst, 'reload schema';
