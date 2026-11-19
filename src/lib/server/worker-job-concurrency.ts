import type { SupabaseClient } from '@supabase/supabase-js';

export async function countTrulyActiveWorkerJobs(input: {
  supabase: SupabaseClient;
  ownerId: string;
  nowIso?: string;
}): Promise<{ count: number; error: unknown | null }> {
  const nowIso = input.nowIso || new Date().toISOString();
  const { count, error } = await input.supabase
    .from('au_worker_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', input.ownerId)
    .eq('status', 'processing')
    .not('claimed_by', 'is', null)
    .gt('locked_until', nowIso);

  return {
    count: Number(count || 0),
    error,
  };
}
