-- Migration: Mark All Read Function
-- 20260209010000_mark_all_read.sql

CREATE OR REPLACE FUNCTION mark_all_read(p_user_id UUID)
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
        AND is_read = false;
END;
$$;

GRANT EXECUTE ON FUNCTION mark_all_read(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION mark_all_read(UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
