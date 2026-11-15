-- Keep provider billing/usage telemetry as structured operational metadata.
-- No prompts, retrieved passages, document contents, or chat history are written here.
ALTER TABLE public.au_usage_events
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS model text,
  ADD COLUMN IF NOT EXISTS prompt_tokens integer,
  ADD COLUMN IF NOT EXISTS completion_tokens integer,
  ADD COLUMN IF NOT EXISTS total_tokens integer,
  ADD COLUMN IF NOT EXISTS cost_usd numeric,
  ADD COLUMN IF NOT EXISTS price_version text,
  ADD COLUMN IF NOT EXISTS provider_request_id text,
  ADD COLUMN IF NOT EXISTS latency_ms integer;

COMMENT ON COLUMN public.au_usage_events.provider IS
  'AI provider identifier for usage and cost attribution; never includes prompt content.';
COMMENT ON COLUMN public.au_usage_events.model IS
  'AI model identifier for operational usage attribution.';
COMMENT ON COLUMN public.au_usage_events.provider_request_id IS
  'Opaque upstream request identifier used for support and billing reconciliation.';
