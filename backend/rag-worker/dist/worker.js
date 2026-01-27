"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RAGWorker = void 0;
const utils_1 = require("./utils");
class RAGWorker {
    supabase;
    ingestion;
    isRunning = false;
    constructor(supabase, ingestion) {
        this.supabase = supabase;
        this.ingestion = ingestion;
    }
    async start() {
        this.isRunning = true;
        utils_1.logger.info('Worker started');
        while (this.isRunning) {
            try {
                await this.poll();
            }
            catch (err) {
                utils_1.logger.error('Worker poll error', err);
                // Wait before retry
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }
    stop() {
        this.isRunning = false;
        utils_1.logger.info('Worker stopping');
    }
    async poll() {
        // 1. Claim a job using RPC (SELECT ... FOR UPDATE SKIP LOCKED)
        const { data: job, error } = await this.supabase.rpc('claim_upload_job');
        if (error) {
            throw error;
        }
        if (!job || job.length === 0) {
            // No jobs, sleep a bit
            await new Promise(resolve => setTimeout(resolve, 2000));
            return;
        }
        const currentJob = job[0];
        utils_1.logger.info('Job claimed', { jobId: currentJob.job_id });
        // Log to DB
        await this.supabase.from("au_debug_logs").insert({
            component: "rag-worker",
            message: "Job claimed",
            details: { jobId: currentJob.job_id }
        });
        try {
            await this.processJob(currentJob);
            // 2. Mark job as done
            await this.supabase
                .from('au_upload_jobs')
                .update({ status: 'done', progress: 100 })
                .eq('id', currentJob.job_id);
            utils_1.logger.info('Job completed', { jobId: currentJob.job_id });
            // Log success to DB
            await this.supabase.from("au_debug_logs").insert({
                component: "rag-worker",
                message: "Job completed",
                details: { jobId: currentJob.job_id }
            });
        }
        catch (processErr) {
            utils_1.logger.error('Job failed', { jobId: currentJob.job_id, error: processErr });
            // Log failure to DB
            await this.supabase.from("au_debug_logs").insert({
                component: "rag-worker",
                message: "Job failed",
                details: {
                    jobId: currentJob.job_id,
                    error: processErr instanceof Error ? processErr.message : String(processErr),
                    stack: processErr instanceof Error ? processErr.stack : null
                }
            });
            // 3. Mark job as failed
            await this.supabase
                .from('au_upload_jobs')
                .update({
                status: 'failed',
                error: processErr instanceof Error ? processErr.message : String(processErr)
            })
                .eq('id', currentJob.job_id);
        }
    }
    async processJob(job) {
        // 1. Download file
        const { data: fileData, error: downloadError } = await this.supabase.storage
            .from(job.bucket)
            .download(job.object_path);
        if (downloadError)
            throw downloadError;
        // 2. Extract text (Simplified for example)
        const text = await fileData.text();
        // 3. Chunking
        const chunks = (0, utils_1.deterministicChunking)(text);
        // 4. Upsert Chunks
        await this.ingestion.upsertChunks(chunks.map((t, i) => ({
            document_id: job.document_id,
            text: t,
            chunk_index: i,
            user_id: job.user_id,
            guest_session_id: job.guest_session_id
        })));
        // 5. Generate Embeddings
        await this.ingestion.processEmbeddings(job.document_id);
    }
}
exports.RAGWorker = RAGWorker;
