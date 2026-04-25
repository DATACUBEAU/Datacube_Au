-- Fix au_documents to support cascading deletes for children (folders)
-- This ensures that when a folder is deleted, all its children are also deleted from the database.

-- First, drop the existing foreign key constraint
ALTER TABLE au_documents DROP CONSTRAINT IF EXISTS au_documents_parent_id_fkey;

-- Re-add the constraint with ON DELETE CASCADE
ALTER TABLE au_documents
ADD CONSTRAINT au_documents_parent_id_fkey
FOREIGN KEY (parent_id)
REFERENCES au_documents(id)
ON DELETE CASCADE;

-- Also ensure au_upload_jobs has the same if it was missing (though it was already there)
ALTER TABLE au_upload_jobs DROP CONSTRAINT IF EXISTS au_upload_jobs_document_id_fkey;
ALTER TABLE au_upload_jobs
ADD CONSTRAINT au_upload_jobs_document_id_fkey
FOREIGN KEY (document_id)
REFERENCES au_documents(id)
ON DELETE CASCADE;
