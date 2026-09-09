-- Canonicalize immutable admin-usage audit attribution at the ledger boundary.
--
-- The versioned admin RPCs verify actor_user_id against auth.uid(), but their
-- actor_email parameter is caller supplied. A direct authenticated Conex/admin
-- caller could therefore persist a misleading email while retaining the correct
-- actor UUID. Derive the readable audit email from auth.users for every ledger
-- insert/update so all mutation paths share one authoritative attribution rule.

BEGIN;

CREATE OR REPLACE FUNCTION public.canonicalize_usage_adjustment_actor_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor_email TEXT;
BEGIN
  IF NEW.actor_user_id IS NULL THEN
    RAISE EXCEPTION 'usage_adjustment_actor_required' USING ERRCODE = '22023';
  END IF;

  SELECT NULLIF(TRIM(email), '')
  INTO v_actor_email
  FROM auth.users
  WHERE id = NEW.actor_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'usage_adjustment_actor_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Never trust caller-provided actor_email. The UUID remains the durable actor
  -- identity; this field is only its canonical human-readable audit snapshot.
  NEW.actor_email := v_actor_email;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.canonicalize_usage_adjustment_actor_email() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_au_usage_admin_adjustments_actor_email
  ON public.au_usage_admin_adjustments;
CREATE TRIGGER trg_au_usage_admin_adjustments_actor_email
  BEFORE INSERT OR UPDATE OF actor_user_id, actor_email
  ON public.au_usage_admin_adjustments
  FOR EACH ROW
  EXECUTE FUNCTION public.canonicalize_usage_adjustment_actor_email();

COMMIT;
