import type { AuDocumentType } from '../au/types';

export type UploadJobStatus =
  | 'queued'
  | 'uploading'
  | 'uploaded'
  | 'processing'
  | 'completed'
  | 'done'
  | 'failed'
  | 'cancelled'
  | 'stale_timeout'
  | 'deleting';

export type UploadJobRow = {
  id: string;
  upload_id?: string | null;
  user_id: string | null;
  owner_id?: string | null;
  document_id: string;
  document_type?: AuDocumentType | null;
  parent_id?: string | null;
  label: string | null;
  file_name: string;
  mime_type: string | null;
  file_size_bytes: number;
  bucket: string;
  object_path: string;
  status: UploadJobStatus;
  progress: number;
  tus_url: string | null;
  error?: string | null; // Optional: column may not exist in some database schemas
  created_at: string;
  updated_at: string;
};

export type CreateUploadJobInput = {
  file: File;
  label?: string;
  documentType: AuDocumentType;
  parentId?: string | null;
};
