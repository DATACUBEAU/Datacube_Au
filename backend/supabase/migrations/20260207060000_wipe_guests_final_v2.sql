-- Migration: Final wipe of all guest data and enforcement of guest disablement
-- 20260207060000_wipe_guests_final_v2.sql

-- 1. Disable Guest Access in Config (Ensure it's set)
DO $$ 
BEGIN 
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'au_conex_config' AND column_name = 'guest_access_enabled') THEN
        UPDATE au_conex_config SET guest_access_enabled = false WHERE id = 1;
    END IF;
END $$;

-- 2. Truncate Guest Sessions (Cascade to messages, etc)
TRUNCATE TABLE au_guest_sessions CASCADE;

-- 3. Cleanup Orphaned Activity
-- Delete activity not linked to a valid auth user
DELETE FROM au_user_activity
WHERE user_id NOT IN (SELECT id FROM au_users);

-- 4. Cleanup Orphaned Messages
DELETE FROM au_messages
WHERE user_id IS NOT NULL AND user_id NOT IN (SELECT id FROM au_users);

-- 5. Cleanup Orphaned Events
DELETE FROM au_events
WHERE user_id NOT IN (SELECT id FROM au_users);

-- 6. Cleanup Orphaned Notifications
DELETE FROM au_user_notifications
WHERE user_id IS NOT NULL AND user_id NOT IN (SELECT id FROM au_users);

-- 7. Cleanup Orphaned Direct Messages
DELETE FROM au_direct_messages
WHERE user_id IS NOT NULL AND user_id NOT IN (SELECT id FROM au_users);
