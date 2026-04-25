-- Migration: Admin Audit Logging and Generation Reset
-- 20260322153000_admin_audit_and_cache_reset.sql

-- 1. Create Admin Audit Logs Table
CREATE TABLE IF NOT EXISTS public.au_admin_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id UUID NOT NULL,
    action TEXT NOT NULL,
    target_user_id UUID,
    target_doc_version_id UUID,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_au_admin_audit_logs_admin_id ON public.au_admin_audit_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_au_admin_audit_logs_action ON public.au_admin_audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_au_admin_audit_logs_target_user_id ON public.au_admin_audit_logs(target_user_id);
CREATE INDEX IF NOT EXISTS idx_au_admin_audit_logs_created_at ON public.au_admin_audit_logs(created_at DESC);

-- Enable RLS
ALTER TABLE public.au_admin_audit_logs ENABLE ROW LEVEL SECURITY;

-- Only service_role can access (Conex Admin uses adminSupabase)
CREATE POLICY "Admin access only" ON public.au_admin_audit_logs FOR ALL USING (false);

-- 2. Audit logging helper function
CREATE OR REPLACE FUNCTION log_admin_action(
    p_admin_id UUID,
    p_action TEXT,
    p_target_user_id UUID DEFAULT NULL,
    p_target_doc_version_id UUID DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_id UUID;
BEGIN
    INSERT INTO public.au_admin_audit_logs (admin_id, action, target_user_id, target_doc_version_id, metadata)
    VALUES (p_admin_id, p_action, p_target_user_id, p_target_doc_version_id, p_metadata)
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;
