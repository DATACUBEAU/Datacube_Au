-- Provider-started requests must not be expired by normal lease cleanup.
DO $$
DECLARE
  v_oid regprocedure;
  v_def text;
  v_old text;
  v_new text;
BEGIN
  v_oid := 'public.reserve_ai_usage(uuid,text,text,text,text,jsonb,jsonb,integer,text,timestamp with time zone)'::regprocedure;
  v_def := pg_get_functiondef(v_oid);
  v_old := 'IF v_existing.status = ''reserved'' AND v_existing.expires_at <= now() THEN';
  v_new := 'IF v_existing.status = ''reserved'' AND v_existing.expires_at <= now() AND v_existing.provider_started_at IS NULL THEN';
  IF length(v_def) - length(replace(v_def, v_old, '')) <> length(v_old) THEN
    RAISE EXCEPTION 'Unexpected reserve_ai_usage definition; refusing partial patch';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);

  v_oid := 'public.begin_ai_usage_reservation(uuid,uuid,text,text,text,text,text,text)'::regprocedure;
  v_def := pg_get_functiondef(v_oid);
  v_old := 'IF v_row.status = ''reserved'' AND v_row.expires_at <= now() THEN';
  v_new := 'IF v_row.status = ''reserved'' AND v_row.expires_at <= now() AND v_row.provider_started_at IS NULL THEN';
  IF length(v_def) - length(replace(v_def, v_old, '')) <> length(v_old) THEN
    RAISE EXCEPTION 'Unexpected begin_ai_usage_reservation definition; refusing partial patch';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);

  v_oid := 'public.release_ai_usage(uuid,uuid,text,text,text,text,text,text)'::regprocedure;
  v_def := pg_get_functiondef(v_oid);
  v_old := 'v_snapshot := public.increment_usage_counters(
    v_row.user_id,
    public.ai_usage_negate_units(v_row.reserved_units),
    v_row.usage_day
  );';
  v_new := 'IF v_next_status <> ''disputed'' THEN
    v_snapshot := public.increment_usage_counters(
      v_row.user_id,
      public.ai_usage_negate_units(v_row.reserved_units),
      v_row.usage_day
    );
  END IF;';
  IF length(v_def) - length(replace(v_def, v_old, '')) <> length(v_old) THEN
    RAISE EXCEPTION 'Unexpected release_ai_usage definition; refusing partial patch';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);

  v_oid := 'public.expire_ai_usage_reservations(integer)'::regprocedure;
  v_def := pg_get_functiondef(v_oid);
  v_old := 'WHERE status = ''reserved''
      AND expires_at <= now()';
  v_new := 'WHERE status = ''reserved''
      AND expires_at <= now()
      AND provider_started_at IS NULL';
  IF length(v_def) - length(replace(v_def, v_old, '')) <> length(v_old) THEN
    RAISE EXCEPTION 'Unexpected expire_ai_usage_reservations definition; refusing partial patch';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END;
$$;
