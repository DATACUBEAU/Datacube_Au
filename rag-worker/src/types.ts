export interface UploadJob {
  id: string;
  document_id: string;
  owner_id?: string | null;
  user_id?: string | null;
  bucket: string;
  object_path: string;
  metadata?: any;
  status?: string;
  progress?: number;
  updated_at?: string;
}

export interface Chunk {
  document_id: string;
  text: string;
  chunk_index: number;
  owner_id: string;
}

export interface Embedding {
  chunk_id: string;
  embedding: number[];
  model_name: string;
}

export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed';
