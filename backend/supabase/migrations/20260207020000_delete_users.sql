-- Migration: Delete specific users
-- 20260207020000_delete_users.sql

DO $$
DECLARE
    target_email TEXT := 'fabiansazzy1214@gmail.com';
    guest_ids UUID[] := ARRAY[
        'fdf0a30d-c115-4c7f-b201-c1bfa649e249',
        '36d0e8ce-abe7-4f0f-8f7e-08f021f2b8f4',
        '613c3750-ed40-4667-a473-160c5bec440c',
        '8892c10c-b704-4969-9aec-7894e695f451',
        '914b860c-255c-4e25-9417-e66b449e9568',
        '5653a004-ce8f-43b2-925a-21f1410f08a4',
        '4b201de1-084c-46b9-b0df-13b52ba29caf',
        '649a16d4-90c5-49ad-af5e-37909eadbb89',
        'b3dbdb81-b9f8-43cc-9bd5-c9a8b0ef8c41',
        '42756f1e-9dbd-4119-a748-31dee8c73472',
        '82bd8a42-ff62-4836-925a-b652471899c7',
        '71edfc4a-5126-4fb4-a6b5-f926103c3b78'
    ]::UUID[];
    user_rec RECORD;
BEGIN
    -- 1. Delete Guest Sessions
    DELETE FROM au_guest_sessions WHERE id = ANY(guest_ids);
    
    -- 2. Delete Auth User (and cascade to au_users via trigger/FK if exists)
    -- First, verify if the user exists in auth.users
    SELECT id INTO user_rec FROM auth.users WHERE email = target_email;
    
    IF user_rec.id IS NOT NULL THEN
        -- Delete related data first if no cascade
        DELETE FROM au_user_profiles WHERE user_id = user_rec.id;
        DELETE FROM au_user_activity WHERE user_id = user_rec.id;
        DELETE FROM au_messages WHERE user_id = user_rec.id;
        DELETE FROM au_sessions WHERE user_id = user_rec.id;
        DELETE FROM au_manual_payments WHERE user_id = user_rec.id;
        DELETE FROM au_events WHERE user_id = user_rec.id;
        DELETE FROM au_users WHERE id = user_rec.id;
        
        -- Finally delete from auth.users
        DELETE FROM auth.users WHERE id = user_rec.id;
    END IF;

END $$;
