
import { SupabaseClient } from '@supabase/supabase-js';
import { IngestionService } from './ingestion';
import { logger, deterministicChunking } from './utils';
import { UploadJob } from './types';
import pdf from 'pdf-parse';
import mammoth from 'mammoth';

export class RAGWorker {
  private isRunning: boolean = false;
  private workerId: string;

  constructor(
    private supabase: SupabaseClient,
    private ingestion: IngestionService
  ) {
    this.workerId = `vultr-worker-${process.env.HOSTNAME || Math.random().toString(36).substring(7)}`;
  }

  async start() {
    this.isRunning = true;
    logger.info('Worker started', { workerId: this.workerId });
    
    while (this.isRunning) {
      try {
        // Parallel polling for jobs and deletions
        await Promise.all([
          this.pollJobs(),
          this.pollDeletions()
        ]);
        
        // Wait briefly to prevent hot loop if idle
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (err) {
        logger.error('Worker loop error', err);
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }

  stop() {
    this.isRunning = false;
    logger.info('Worker stopping');
  }

  private async pollDeletions() {
      // Fetch unprocessed deletion logs
      const { data: logs, error } = await this.supabase
        .from('au_deletion_log')
        .select('*')
        .eq('processed', false)
        .limit(10);

      if (error) {
          logger.error('Error polling deletion logs', error);
          return;
      }

      if (!logs || logs.length === 0) return;

      logger.info(`Found ${logs.length} documents to delete`);

      for (const log of logs) {
          try {
              // 1. Delete Vectors from Qdrant
              await this.ingestion.deleteDocument(log.document_id);

              // 2. Delete from Storage (if path exists and not already deleted)
              if (log.file_path) {
                  const bucket = 'documents'; // Or fetch from somewhere if dynamic
                  const { error: storageError } = await this.supabase.storage
                      .from(bucket)
                      .remove([log.file_path]);
                  
                  if (storageError) {
                      logger.warn(`Storage deletion warning for ${log.document_id}`, storageError);
                  }
              }

              // 3. Mark as processed
              await this.supabase
                  .from('au_deletion_log')
                  .update({ processed: true, processed_at: new Date().toISOString() })
                  .eq('id', log.id);
                  
              logger.info(`Processed deletion for ${log.document_id}`);

          } catch (e) {
              logger.error(`Failed to process deletion for ${log.document_id}`, e);
          }
      }
  }

  private async pollJobs() {
    // 1. Claim a job using the new RPC with lease-based locking
    const { data: jobs, error } = await this.supabase.rpc('claim_worker_job', {
      p_worker_id: this.workerId,
      p_lease_duration_ms: 300000 // 5 minutes
    });

    if (error) {
      throw error;
    }

    if (!jobs || jobs.length === 0) {
      return;
    }

    const currentJob: UploadJob = jobs[0];
    logger.info('Job claimed', { jobId: currentJob.id, documentId: currentJob.document_id });

    // Log to DB
    await this.supabase.from("au_debug_logs").insert({
      component: "rag-worker",
      message: "Job claimed",
      details: { jobId: currentJob.id, workerId: this.workerId }
    });

    try {
      await this.processJob(currentJob);
      
      // 2. Mark job as completed
      await this.supabase
        .from('au_worker_jobs')
        .update({ 
          status: 'completed', 
          progress: 100,
          updated_at: new Date().toISOString()
        })
        .eq('id', currentJob.id);
      
      logger.info('Job completed', { jobId: currentJob.id });

      // Log success to DB
      await this.supabase.from("au_debug_logs").insert({
        component: "rag-worker",
        message: "Job completed",
        details: { jobId: currentJob.id }
      });

      // 3. DELETE ORIGINAL FILE (Success only)
      try {
        logger.info('Deleting file from Supabase Storage', { bucket: currentJob.bucket, path: currentJob.object_path });
        const { error: deleteError } = await this.supabase.storage
          .from(currentJob.bucket)
          .remove([currentJob.object_path]);
        
        if (deleteError) {
             logger.error('Failed to delete file from storage', deleteError);
        } else {
             logger.info('File deleted successfully');
             // Update DB
             await this.supabase.from('au_documents')
                .update({ storage_deleted_at: new Date().toISOString() })
                .eq('id', currentJob.document_id);
        }
      } catch (delErr) {
        logger.error('Failed to delete file (exception)', delErr);
      }

    } catch (processErr) {
      logger.error('Job failed', { jobId: currentJob.id, error: processErr });
      
      const errorMessage = processErr instanceof Error ? processErr.message : String(processErr);

      // Log failure to DB
      await this.supabase.from("au_debug_logs").insert({
        component: "rag-worker",
        message: "Job failed",
        details: { 
          jobId: currentJob.id, 
          error: errorMessage,
          stack: processErr instanceof Error ? processErr.stack : null
        }
      });

      // 4. Mark job as failed
      await this.supabase
        .from('au_worker_jobs')
        .update({ 
          status: 'failed', 
          error: errorMessage,
          updated_at: new Date().toISOString()
        })
        .eq('id', currentJob.id);
    }
  }

  private async processJob(job: UploadJob) {
    // 1. Download file from Supabase Storage
    logger.info('Downloading file', { bucket: job.bucket, path: job.object_path });
    const { data: fileData, error: downloadError } = await this.supabase.storage
      .from(job.bucket)
      .download(job.object_path);

    if (downloadError) throw downloadError;

    // 2. Extract text based on file type
    let text = '';
    const buffer = Buffer.from(await fileData.arrayBuffer());
    const extension = job.object_path.split('.').pop()?.toLowerCase();

    if (extension === 'pdf') {
      const pdfData = await pdf(buffer);
      text = pdfData.text;
    } else if (extension === 'docx') {
      const result = await mammoth.extractRawText({ buffer });
      text = result.value;
    } else {
      // Default to text
      text = buffer.toString('utf-8');
    }

    if (!text || text.trim().length === 0) {
      throw new Error('No text content extracted from document');
    }
    
    // 3. Chunking
    const chunks = deterministicChunking(text);

    // 4. Determine Retention
    const { data: profile } = await this.supabase
      .from('au_user_profiles')
      .select('tier')
      .eq('user_id', job.owner_id)
      .single();
    
    const tier = profile?.tier || 'free';
    const retentionDays = tier === 'pro' ? 30 : 14;
    const expiresAt = Math.floor(Date.now() / 1000) + (retentionDays * 24 * 60 * 60);
    
    // 5. Ingest (Embeddings + Qdrant)
    await this.ingestion.processDocument(
      job.document_id,
      chunks,
      job.owner_id,
      expiresAt
    );
  }
}
