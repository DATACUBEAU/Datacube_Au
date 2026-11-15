CREATE TABLE IF NOT EXISTS public.au_documents (
  id uuid PRIMARY KEY, owner_id uuid, user_id uuid, file_size_bytes bigint,
  expires_at timestamptz, parent_id uuid, parent_document_id uuid
);
ALTER TABLE public.au_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.au_documents FROM PUBLIC, anon, authenticated, service_role;
