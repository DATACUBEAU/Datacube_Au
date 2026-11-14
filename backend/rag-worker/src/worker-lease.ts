import type { SupabaseClient } from '@supabase/supabase-js';

export type WorkerLeaseGuard = () => Promise<void>;

export class WorkerLeaseLostError extends Error {
  constructor(jobId: string) {
    super('Worker lease no longer owned for job ' + jobId);
    this.name = 'WorkerLeaseLostError';
  }
}

/**
 * Re-reads the durable job row immediately before a worker performs a
 * document-side effect. Database errors propagate; only an absent, reclaimed,
 * or expired lease is classified as ownership loss.
 */
export async function assertWorkerLeaseOwnership(
  supabase: SupabaseClient,
  jobId: string,
  workerInstanceId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from('au_worker_jobs')
    .select('id,locked_until')
    .eq('id', jobId)
    .eq('status', 'processing')
    .eq('claimed_by', workerInstanceId)
    .maybeSingle();

  if (error) throw error;

  const lockedUntil = Date.parse(String((data as any)?.locked_until || ''));
  if (!data || !Number.isFinite(lockedUntil) || lockedUntil <= Date.now()) {
    throw new WorkerLeaseLostError(jobId);
  }
}
