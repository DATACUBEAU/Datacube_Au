-- Wipe all guests final
-- 20260207050000_wipe_all_guests_final.sql

-- 1. Drop the table entirely (CASCADE will handle dependencies like documents, chats, etc.)
DROP TABLE IF EXISTS au_guest_sessions CASCADE;

-- 2. Drop the edge function policy that managed it (if it still exists after cascade)
-- (It was on the table, so it's gone)

-- 3. Clean up any lingering guest columns in other tables if desired, 
-- or leave them nullable for future use. 
-- For "forget about guest session", we should probably remove the columns or at least the foreign keys.
-- But since we dropped CASCADE, the FK constraints are gone. The columns `guest_session_id` remain but are just UUIDs now.

-- 4. Clean up the cron job if it exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('cleanup_guest_data');
  END IF;
END $$;
