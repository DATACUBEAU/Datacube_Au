-- 1. Refine au_rate_limits to match User Spec (Key-based)
DROP TABLE IF EXISTS public.au_rate_limits;

CREATE TABLE public.au_rate_limits (
  key text primary key,
  owner_id uuid null,
  ip_hash text null,
  endpoint text not null,
  window_start timestamptz not null,
  window_seconds int not null,
  count int not null default 0,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS au_rate_limits_expires_idx ON public.au_rate_limits (expires_at);
CREATE INDEX IF NOT EXISTS au_rate_limits_owner_endpoint_window_idx ON public.au_rate_limits (owner_id, endpoint, window_start);
CREATE INDEX IF NOT EXISTS au_rate_limits_ip_endpoint_window_idx ON public.au_rate_limits (ip_hash, endpoint, window_start);

ALTER TABLE public.au_rate_limits ENABLE ROW LEVEL SECURITY;
-- No access for anon/auth, only service_role
CREATE POLICY "No direct access" ON public.au_rate_limits FOR ALL TO authenticated USING (false) WITH CHECK (false);


-- 2. Admin Lockout Tables
CREATE TABLE IF NOT EXISTS public.au_admin_auth_attempts (
  id bigserial primary key,
  ip_hash text not null,
  device_id text not null,
  route text not null default '/conex',
  user_agent_hash text null,
  attempt_type text not null default 'passcode',
  success boolean not null default false,
  created_at timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS au_admin_attempts_key_time_idx ON public.au_admin_auth_attempts (ip_hash, device_id, route, created_at desc);

CREATE TABLE IF NOT EXISTS public.au_admin_locks (
  lock_key text primary key, -- ip_hash:device_id:route
  locked_until timestamptz not null,
  fail_count int not null default 0,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS au_admin_locks_until_idx ON public.au_admin_locks (locked_until);

ALTER TABLE public.au_admin_auth_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.au_admin_locks ENABLE ROW LEVEL SECURITY;


-- 3. Weekly Feature Usage
CREATE TABLE IF NOT EXISTS public.au_weekly_feature_usage (
  owner_id uuid not null,
  week_start_date date not null,
  active_doc_id uuid null,

  summary_used boolean not null default false,
  prediction_used boolean not null default false,
  cbt_used boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (owner_id, week_start_date)
);

CREATE INDEX IF NOT EXISTS au_weekly_usage_active_doc_idx ON public.au_weekly_feature_usage (owner_id, week_start_date, active_doc_id);

ALTER TABLE public.au_weekly_feature_usage ENABLE ROW LEVEL SECURITY;


-- 4. Update Security Events (Add ip_hash if missing)
-- (Assuming au_security_events exists from previous step, checking if we need to add ip_hash column if it was ip_address)
-- Actually, we can just add ip_hash column if it doesn't exist, or use ip_address as hash storage.
-- Let's add ip_hash explicitly to be safe and consistent.
ALTER TABLE public.au_security_events ADD COLUMN IF NOT EXISTS ip_hash text;


-- 5. RPC: Atomic Rate Limit Hit
CREATE OR REPLACE FUNCTION au_rate_limit_hit(
  p_key text,
  p_owner_id uuid,
  p_ip_hash text,
  p_endpoint text,
  p_window_start timestamptz,
  p_window_seconds int
) RETURNS TABLE (current_count int, expires_at timestamptz) AS $$
DECLARE
  v_expires_at timestamptz;
  v_count int;
BEGIN
  v_expires_at := p_window_start + (p_window_seconds || ' seconds')::interval;

  INSERT INTO public.au_rate_limits (key, owner_id, ip_hash, endpoint, window_start, window_seconds, count, expires_at)
  VALUES (p_key, p_owner_id, p_ip_hash, p_endpoint, p_window_start, p_window_seconds, 1, v_expires_at)
  ON CONFLICT (key)
  DO UPDATE SET
    count = public.au_rate_limits.count + 1,
    updated_at = now()
  RETURNING count, public.au_rate_limits.expires_at INTO v_count, v_expires_at;

  RETURN QUERY SELECT v_count, v_expires_at;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 6. RPC: Weekly Feature Claim (Atomic)
CREATE OR REPLACE FUNCTION au_claim_weekly_feature(
  p_owner_id uuid,
  p_week_start_date date,
  p_doc_id uuid,
  p_feature text -- 'summary', 'prediction', 'cbt'
) RETURNS TABLE (success boolean, reason text) AS $$
DECLARE
  v_row public.au_weekly_feature_usage%ROWTYPE;
BEGIN
  -- 1. Ensure row exists
  INSERT INTO public.au_weekly_feature_usage (owner_id, week_start_date)
  VALUES (p_owner_id, p_week_start_date)
  ON CONFLICT (owner_id, week_start_date) DO NOTHING;

  -- 2. Attempt to update
  UPDATE public.au_weekly_feature_usage
  SET
    active_doc_id = COALESCE(active_doc_id, p_doc_id),
    summary_used = CASE WHEN p_feature = 'summary' THEN true ELSE summary_used END,
    prediction_used = CASE WHEN p_feature = 'prediction' THEN true ELSE prediction_used END,
    cbt_used = CASE WHEN p_feature = 'cbt' THEN true ELSE cbt_used END,
    updated_at = now()
  WHERE owner_id = p_owner_id
    AND week_start_date = p_week_start_date
    AND (active_doc_id IS NULL OR active_doc_id = p_doc_id)
    AND (
      (p_feature = 'summary' AND summary_used = false) OR
      (p_feature = 'prediction' AND prediction_used = false) OR
      (p_feature = 'cbt' AND cbt_used = false)
    )
  RETURNING * INTO v_row;

  IF FOUND THEN
    RETURN QUERY SELECT true, 'claimed';
  ELSE
    -- Check why it failed (read-only check)
    SELECT * INTO v_row FROM public.au_weekly_feature_usage
    WHERE owner_id = p_owner_id AND week_start_date = p_week_start_date;

    IF v_row.active_doc_id IS DISTINCT FROM p_doc_id THEN
      RETURN QUERY SELECT false, 'wrong_doc';
    ELSE
      RETURN QUERY SELECT false, 'already_used';
    END IF;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
