-- Expand the canonical registry to represent both free and paid models.
-- Keep the paid registry intact as a compatibility source until admin callers migrate.
ALTER TABLE public.au_models_registry
  ADD COLUMN IF NOT EXISTS capabilities text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS size_class text;

ALTER TABLE public.au_pro_models_registry
  ADD COLUMN IF NOT EXISTS capabilities text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS size_class text;

INSERT INTO public.au_models_registry (
  model_id, display_name, provider, type, is_free, is_active,
  context_window, rate_limit_rpm, rate_limit_tpm, usage_constraints,
  created_at, updated_at, capabilities, size_class
)
SELECT
  paid.model_id, paid.display_name, paid.provider, COALESCE(paid.type, 'chat'), COALESCE(paid.is_free, false),
  COALESCE(paid.is_active, false), paid.context_window, paid.rate_limit_rpm, paid.rate_limit_tpm,
  paid.usage_constraints, COALESCE(paid.created_at, now()), COALESCE(paid.updated_at, now()),
  COALESCE(paid.capabilities, ARRAY[]::text[]), paid.size_class
FROM public.au_pro_models_registry AS paid
ON CONFLICT (model_id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  provider = EXCLUDED.provider,
  type = EXCLUDED.type,
  is_free = EXCLUDED.is_free,
  is_active = EXCLUDED.is_active,
  context_window = EXCLUDED.context_window,
  rate_limit_rpm = EXCLUDED.rate_limit_rpm,
  rate_limit_tpm = EXCLUDED.rate_limit_tpm,
  usage_constraints = EXCLUDED.usage_constraints,
  capabilities = EXCLUDED.capabilities,
  size_class = EXCLUDED.size_class,
  updated_at = now();

COMMENT ON COLUMN public.au_models_registry.capabilities IS
  'Capabilities supported by the model; canonical free and paid model catalog.';
COMMENT ON COLUMN public.au_models_registry.size_class IS
  'Optional model size classification used by routing and admin tooling.';
