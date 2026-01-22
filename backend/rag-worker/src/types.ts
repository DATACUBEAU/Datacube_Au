export interface UploadJob {
  job_id: string;
  document_id: string;
  user_id: string;
  guest_session_id?: string;
  file_name: string;
  bucket: string;
  object_path: string;
}

export interface Chunk {
  document_id: string;
  text: string;
  chunk_index: number;
  user_id?: string;
  guest_session_id?: string;
}

export interface Embedding {
  chunk_id: string;
  embedding: number[];
  model_name: string;
}

export type JobStatus = 'queued' | 'processing' | 'done' | 'failed';
