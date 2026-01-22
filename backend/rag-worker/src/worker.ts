import { SupabaseClient } from '@supabase/supabase-js';
import { IngestionService } from './ingestion';
import { logger, deterministicChunking } from './utils';
import { UploadJob } from './types';

export class RAGWorker {
  private isRunning: boolean = false;

  constructor(
    private supabase: SupabaseClient,
    private ingestion: IngestionService
  ) {}

  async start() {
    this.isRunning = true;
    logger.info('Worker started');
    
    while (this.isRunning) {
      try {
        await this.poll();
      } catch (err) {
        logger.error('Worker poll error', err);
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }

  stop() {
    this.isRunning = false;
    logger.info('Worker stopping');
  }

  private async poll() {
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

    const currentJob: UploadJob = job[0];
    logger.info('Job claimed', { jobId: currentJob.job_id });

    try {
      await this.processJob(currentJob);
      
      // 2. Mark job as done
      await this.supabase
        .from('au_upload_jobs')
        .update({ status: 'done', progress: 100 })
        .eq('id', currentJob.job_id);
      
      logger.info('Job completed', { jobId: currentJob.job_id });
    } catch (processErr) {
      logger.error('Job failed', { jobId: currentJob.job_id, error: processErr });
      
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

  private async processJob(job: UploadJob) {
    // 1. Download file
    const { data: fileData, error: downloadError } = await this.supabase.storage
      .from(job.bucket)
      .download(job.object_path);

    if (downloadError) throw downloadError;

    // 2. Extract text (Simplified for example)
    const text = await fileData.text();
    
    // 3. Chunking
    const chunks = deterministicChunking(text);
    
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
