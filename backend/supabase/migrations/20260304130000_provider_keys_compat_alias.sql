-- Compatibility bridge for environments where legacy code still references
-- public.ai_provider_keys while newer code uses public.au_api_keys (or vice versa).

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.au_api_keys') IS NOT NULL
     AND to_regclass('public.ai_provider_keys') IS NULL THEN
    EXECUTE 'CREATE VIEW public.ai_provider_keys AS SELECT * FROM public.au_api_keys';
  END IF;

  IF to_regclass('public.ai_provider_keys') IS NOT NULL
     AND to_regclass('public.au_api_keys') IS NULL THEN
    EXECUTE 'CREATE VIEW public.au_api_keys AS SELECT * FROM public.ai_provider_keys';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
