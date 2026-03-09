type WorkerJobsClient = {
  from: (table: string) => any;
};

export async function countTrulyActiveWorkerJobs(input: {
  supabase: WorkerJobsClient;
  ownerId: string;
  nowIso?: string;
}): Promise<{ count: number; error: any | null }> {
  const nowIso = input.nowIso ?? new Date().toISOString();

  const { count, error } = await input.supabase
    .from('au_worker_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', input.ownerId)
    .in('status', ['processing', 'analyzing', 'finalizing'])
    .not('claimed_by', 'is', null)
    .gt('locked_until', nowIso);

  return { count: Number(count || 0), error };
}

