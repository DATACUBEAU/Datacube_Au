ALTER TABLE public.au_documents
  ADD COLUMN IF NOT EXISTS cleanup_pending boolean NOT NULL DEFAULT false;

ALTER TABLE public.au_documents
  ADD COLUMN IF NOT EXISTS cleanup_attempts integer NOT NULL DEFAULT 0;

ALTER TABLE public.au_documents
  ADD COLUMN IF NOT EXISTS cleanup_last_error text;

ALTER TABLE public.au_documents
  ADD COLUMN IF NOT EXISTS cleanup_last_attempt_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_documents_cleanup_pending
  ON public.au_documents (cleanup_pending, created_at)
  WHERE cleanup_pending = true;

NOTIFY pgrst, 'reload schema';
