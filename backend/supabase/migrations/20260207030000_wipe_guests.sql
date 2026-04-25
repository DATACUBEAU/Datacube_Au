-- Migration: Wipe all guest sessions and disable guest access
-- 20260207030000_wipe_guests.sql

-- 1. Wipe all guest data
TRUNCATE TABLE au_guest_sessions CASCADE;

-- 2. Ensure only auth users remain
-- (The TRUNCATE CASCADE above will clean up linked messages/activity for guests)

-- 3. Update Conex Config to disable guest features if the column exists
-- If you have a specific flag for "guest_access_enabled", set it to false.
-- If not, we might need to add it or just assume the UI/Middleware handles it.
-- Let's check/add the column first.

ALTER TABLE au_conex_config 
ADD COLUMN IF NOT EXISTS guest_access_enabled BOOLEAN DEFAULT false;

-- Force disable it
UPDATE au_conex_config 
SET guest_access_enabled = false 
WHERE id = 1;

-- If the row doesn't exist, insert it
INSERT INTO au_conex_config (id, guest_access_enabled)
VALUES (1, false)
ON CONFLICT (id) DO UPDATE 
SET guest_access_enabled = false;
