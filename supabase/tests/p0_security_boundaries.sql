-- Non-mutating assertions for an isolated database after migration replay.
DO $$
DECLARE
  item record;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'Public table without row-level security';
  END IF;
  FOR item IN SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('apply_billing_renewal_failure','admin_set_user_plan_override','approve_manual_payment','apply_plan_transition')
  LOOP
    IF has_function_privilege('anon',item.oid,'EXECUTE') OR has_function_privilege('authenticated',item.oid,'EXECUTE')
      OR NOT has_function_privilege('service_role',item.oid,'EXECUTE') THEN
      RAISE EXCEPTION 'Privileged billing function ACL mismatch: %',item.proname;
    END IF;
  END LOOP;
  IF (SELECT count(DISTINCT p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN ('apply_billing_renewal_failure','admin_set_user_plan_override','approve_manual_payment','apply_plan_transition')) <> 4 THEN
    RAISE EXCEPTION 'Expected four billing function names';
  END IF;
  FOR item IN SELECT * FROM (VALUES
    ('admin_access_logs','Service role full access'),
    ('au_activity_log','Service role full access activity'),
    ('au_auth_mappings','Service role can manage all auth mappings'),
    ('au_conex_config','Service role full access conex config'),
    ('au_config','Service role can insert config'),
    ('au_config','Service role can update config'),
    ('au_events','Service role can manage events'),
    ('au_model_routing','Allow read for everyone model routing')
  ) AS expected(table_name, policy_name)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=item.table_name
      AND p.policyname=item.policy_name AND p.roles=ARRAY['service_role']::name[]) THEN
      RAISE EXCEPTION 'Service-only policy mismatch: %.%',item.table_name,item.policy_name;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='au_config' AND policyname='Allow read for everyone') THEN
    RAISE EXCEPTION 'Legacy public configuration policy still present';
  END IF;
END $$;
