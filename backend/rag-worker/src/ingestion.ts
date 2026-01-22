import { SupabaseClient } from '@supabase/supabase-js';
import { OpenAI } from 'openai';
import { Chunk, Embedding } from './types';
import { logger } from './utils';

export class IngestionService {
  constructor(
    private supabase: SupabaseClient,
    private openai: OpenAI
  ) {}

  /**
   * Upserts chunks into the database using ON CONFLICT.
   * Unique violations (identical chunks in the same document) are ignored.
   */
  async upsertChunks(chunks: Chunk[]): Promise<string[]> {
    logger.info('Upserting chunks', { count: chunks.length, document_id: chunks[0]?.document_id });
    
    // We use the supabase client to insert. 
    // The DB trigger will handle text_hash computation.
    // ON CONFLICT (document_id, text_hash) DO NOTHING.
    const { data, error } = await this.supabase
      .from('au_document_chunks')
      .upsert(
        chunks.map(c => ({
          document_id: c.document_id,
          text: c.text,
          chunk_index: c.chunk_index,
          user_id: c.user_id,
          guest_session_id: c.guest_session_id
        })),
        { 
          onConflict: 'document_id, text_hash',
          ignoreDuplicates: true 
        }
      )
      .select('id');

    if (error) {
      if (error.code === '23505') {
        logger.info('Chunk unique violation (idempotency hit)', { error: error.message });
        // In case of conflict, we might need to fetch the existing IDs if we want to proceed
        // but since we use ignoreDuplicates: true, it should return existing ones if supported,
        // or we fetch them separately.
      } else {
        throw error;
      }
    }

    // Since we need the chunk IDs for embeddings, and ignoreDuplicates might not return all IDs,
    // we fetch all chunk IDs for this document.
    const { data: allChunks, error: fetchError } = await this.supabase
      .from('au_document_chunks')
      .select('id, text')
      .eq('document_id', chunks[0].document_id);

    if (fetchError) throw fetchError;
    
    return allChunks.map(c => c.id);
  }

  /**
   * Generates and upserts embeddings for chunks.
   */
  async processEmbeddings(documentId: string, modelName: string = 'text-embedding-ada-002'): Promise<void> {
    logger.info('Processing embeddings', { documentId, modelName });

    const { data: chunks, error: fetchError } = await this.supabase
      .from('au_document_chunks')
      .select('id, text')
      .eq('document_id', documentId);

    if (fetchError) throw fetchError;

    for (const chunk of chunks) {
      try {
        const embeddingResponse = await this.openai.embeddings.create({
          model: modelName,
          input: chunk.text,
        });

        const embedding = embeddingResponse.data[0].embedding;

        // Atomic upsert for embedding
        const { error: upsertError } = await this.supabase
          .from('au_document_embeddings')
          .upsert({
            chunk_id: chunk.id,
            embedding,
            model_name: modelName
          }, {
            onConflict: 'chunk_id, model_name'
          });

        if (upsertError) {
          logger.error('Failed to upsert embedding', { chunk_id: chunk.id, error: upsertError });
          // We continue to other chunks, but we could also throw
        } else {
          logger.info('Embedding upserted', { chunk_id: chunk.id });
        }
      } catch (err) {
        logger.error('Error generating embedding', { chunk_id: chunk.id, error: err });
      }
    }
  }
}
