export type AuDocumentType = 'main_textbook' | 'past_questions' | 'exam_questions';

export type AuDocumentStatus = 'uploading' | 'processing' | 'completed' | 'failed';

export type AuDocumentRow = {
  id: string;
  user_id: string;
  document_type: AuDocumentType;
  file_name: string;
  file_path: string;
  status: AuDocumentStatus;
  parent_id: string | null;
  created_at: string;
  expires_at: string | null;
  error: string | null;
};

export type AuDocumentChunkRow = {
  id: string;
  document_id: string;
  user_id: string;
  chunk_index: number;
  text: string;
  created_at: string;
};
