-- Usage counter mutation is a trusted accounting primitive. Browser roles only
-- receive own-row SELECT policies on usage_counters and usage_totals.
REVOKE ALL PRIVILEGES ON FUNCTION public.increment_usage_counters(uuid, jsonb, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_usage_counters(uuid, jsonb, date)
  TO service_role;
