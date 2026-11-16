CREATE OR REPLACE FUNCTION public.is_conex_admin(p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $function$
DECLARE
  v_role text := COALESCE(current_setting('request.jwt.claim.role', true), '');
BEGIN
  IF v_role <> 'service_role' THEN
    IF auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN
      RETURN FALSE;
    END IF;
  END IF;

  RETURN COALESCE(
    p_user_id = '05ad2f16-b3ce-48eb-bf24-41b407556ffd'::uuid
    OR EXISTS (
      SELECT 1
      FROM public.au_user_profiles p
      WHERE p.user_id = p_user_id
        AND (
          LOWER(COALESCE(p.tier, '')) = 'admin'
          OR LOWER(COALESCE(to_jsonb(p) ->> 'role', '')) = 'admin'
        )
    ),
    FALSE
  );
END;
$function$;
