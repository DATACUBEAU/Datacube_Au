export type AuDocumentType = 'main_textbook' | 'past_questions' | 'exam_questions';

export type AuDocumentStatus =
  | 'pending_upload'
  | 'queued'
  | 'uploading'
  | 'uploaded'
  | 'processing'
  | 'completed'
  | 'done'
  | 'indexed'
  | 'failed';

export type AuDocumentRow = {
  id: string;
  user_id: string | null;
  owner_id?: string | null;
  document_type: AuDocumentType | string;
  file_name: string;
  file_path: string;
  status: AuDocumentStatus | string;
  parent_id: string | null;
  created_at: string;
  expires_at: string | null;
  error: string | null;
  metadata?: Record<string, unknown> | null;
};

export type AuDocumentChunkRow = {
  id: string;
  document_id: string;
  user_id: string;
  chunk_index: number;
  text: string;
  created_at: string;
};
