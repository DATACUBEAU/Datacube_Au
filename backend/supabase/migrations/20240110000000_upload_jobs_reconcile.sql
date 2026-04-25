-- Reconcile au_upload_jobs schema for existing installs
-- (CREATE TABLE IF NOT EXISTS does not add missing columns on already-created tables)

ALTER TABLE public.au_upload_jobs
ADD COLUMN IF NOT EXISTS error text;
