-- Harden the legacy manual-payment SECURITY DEFINER function as well.
ALTER FUNCTION public.approve_manual_payment(uuid, uuid, text)
  SET search_path = pg_catalog, public;
