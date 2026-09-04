-- Preserve immutable usage-adjustment attribution without blocking admin account deletion.
--
-- The original audit ledger used ON DELETE RESTRICT for actor_user_id, so any
-- deletable admin who had authored an adjustment could no longer be removed from
-- auth.users. The ledger already stores a canonical actor_email snapshot. Make the
-- actor UUID nullable for lifecycle deletion, retain that readable snapshot, and
-- continue requiring a live actor for all new adjustment rows.

BEGIN;

ALTER TABLE public.au_usage_admin_adjustments
  ALTER COLUMN actor_user_id DROP NOT NULL;

ALTER TABLE public.au_usage_admin_adjustments
  DROP CONSTRAINT IF EXISTS au_usage_admin_adjustments_actor_user_id_fkey;

ALTER TABLE public.au_usage_admin_adjustments
  ADD CONSTRAINT au_usage_admin_adjustments_actor_user_id_fkey
  FOREIGN KEY (actor_user_id)
  REFERENCES auth.users(id)
  ON DELETE SET NULL
  NOT VALID;

ALTER TABLE public.au_usage_admin_adjustments
  VALIDATE CONSTRAINT au_usage_admin_adjustments_actor_user_id_fkey;

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
    -- New ledger entries still require a verified live actor. The nullable state
    -- exists only so the FK can preserve historical audit rows when auth.users is
    -- later deleted. During that FK-driven UPDATE, keep the canonical email that
    -- was snapshotted while the actor still existed.
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'usage_adjustment_actor_required' USING ERRCODE = '22023';
    END IF;

    NEW.actor_email := COALESCE(
      NULLIF(TRIM(COALESCE(NEW.actor_email, '')), ''),
      NULLIF(TRIM(COALESCE(OLD.actor_email, '')), '')
    );
    RETURN NEW;
  END IF;

  SELECT NULLIF(TRIM(email), '')
  INTO v_actor_email
  FROM auth.users
  WHERE id = NEW.actor_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'usage_adjustment_actor_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Never trust caller-provided actor_email while a live actor UUID exists.
  NEW.actor_email := v_actor_email;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.canonicalize_usage_adjustment_actor_email()
  FROM PUBLIC, anon, authenticated;

-- Recreate explicitly so the intended UPDATE-of-actor behavior remains obvious
-- even if this migration is applied after a partially upgraded environment.
DROP TRIGGER IF EXISTS trg_au_usage_admin_adjustments_actor_email
  ON public.au_usage_admin_adjustments;
CREATE TRIGGER trg_au_usage_admin_adjustments_actor_email
  BEFORE INSERT OR UPDATE OF actor_user_id, actor_email
  ON public.au_usage_admin_adjustments
  FOR EACH ROW
  EXECUTE FUNCTION public.canonicalize_usage_adjustment_actor_email();

COMMIT;
