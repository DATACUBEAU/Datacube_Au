-- Migration: Add missing foreign key indexes for performance on au_messages
-- Date: 2026-01-10

-- au_messages indexes
CREATE INDEX IF NOT EXISTS idx_au_messages_session_id ON public.au_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_au_messages_user_id ON public.au_messages(user_id);

-- au_documents parent_id index
CREATE INDEX IF NOT EXISTS idx_au_documents_parent_id ON public.au_documents(parent_id);

-- au_document_chunks document_id index
CREATE INDEX IF NOT EXISTS idx_au_document_chunks_document_id ON public.au_document_chunks(document_id);
