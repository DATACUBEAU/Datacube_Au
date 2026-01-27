"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IngestionService = void 0;
const utils_1 = require("./utils");
class IngestionService {
    supabase;
    openrouter;
    constructor(supabase, openrouter) {
        this.supabase = supabase;
        this.openrouter = openrouter;
    }
    /**
     * Upserts chunks into the database using ON CONFLICT.
     * Unique violations (identical chunks in the same document) are ignored.
     */
    async upsertChunks(chunks) {
        utils_1.logger.info('Upserting chunks', { count: chunks.length, document_id: chunks[0]?.document_id });
        // We use the supabase client to insert. 
        // The DB trigger will handle text_hash computation.
        // ON CONFLICT (document_id, text_hash) DO NOTHING.
        const { data, error } = await this.supabase
            .from('au_document_chunks')
            .upsert(chunks.map(c => ({
            document_id: c.document_id,
            text: c.text,
            chunk_index: c.chunk_index,
            user_id: c.user_id,
            guest_session_id: c.guest_session_id
        })), {
            onConflict: 'document_id, text_hash',
            ignoreDuplicates: true
        })
            .select('id');
        if (error) {
            if (error.code === '23505') {
                utils_1.logger.info('Chunk unique violation (idempotency hit)', { error: error.message });
                // In case of conflict, we might need to fetch the existing IDs if we want to proceed
                // but since we use ignoreDuplicates: true, it should return existing ones if supported,
                // or we fetch them separately.
            }
            else {
                throw error;
            }
        }
        // Since we need the chunk IDs for embeddings, and ignoreDuplicates might not return all IDs,
        // we fetch all chunk IDs for this document.
        const { data: allChunks, error: fetchError } = await this.supabase
            .from('au_document_chunks')
            .select('id, text')
            .eq('document_id', chunks[0].document_id);
        if (fetchError)
            throw fetchError;
        return allChunks.map(c => c.id);
    }
    /**
     * Generates and upserts embeddings for chunks.
     */
    async processEmbeddings(documentId, modelName = 'openai/text-embedding-ada-002') {
        utils_1.logger.info('Processing embeddings', { documentId, modelName });
        const { data: chunks, error: fetchError } = await this.supabase
            .from('au_document_chunks')
            .select('id, text')
            .eq('document_id', documentId);
        if (fetchError)
            throw fetchError;
        for (const chunk of chunks) {
            try {
                const endpoint = 'https://openrouter.ai/api/v1/embeddings';
                utils_1.logger.info('Embedding request', { provider: 'openrouter', endpoint, model: modelName });
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${this.openrouter.apiKey}`,
                        'HTTP-Referer': this.openrouter.httpReferer ?? 'https://datacube-au.vercel.app',
                        'X-Title': this.openrouter.xTitle ?? 'DataCube AU',
                    },
                    body: JSON.stringify({
                        model: modelName,
                        input: chunk.text,
                    }),
                });
                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`OpenRouter Embedding Error: ${response.status} - ${errorText}`);
                }
                const data = await response.json();
                const embedding = data?.data?.[0]?.embedding;
                if (!Array.isArray(embedding)) {
                    throw new Error('Malformed OpenRouter embeddings response: missing embedding');
                }
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
                    utils_1.logger.error('Failed to upsert embedding', { chunk_id: chunk.id, error: upsertError });
                    // We continue to other chunks, but we could also throw
                }
                else {
                    utils_1.logger.info('Embedding upserted', { chunk_id: chunk.id });
                }
            }
            catch (err) {
                utils_1.logger.error('Error generating embedding', { chunk_id: chunk.id, error: err });
            }
        }
    }
}
exports.IngestionService = IngestionService;
