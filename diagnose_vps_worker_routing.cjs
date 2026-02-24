const { createClient } = require('@supabase/supabase-js');

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

  const pipelineId = process.env.WORKER_ID || process.env.PIPELINE_ID || 'vps-worker';
  const workerInstanceId =
    process.env.WORKER_INSTANCE_ID ||
    `${pipelineId}-${process.env.HOSTNAME || Math.random().toString(36).slice(2)}`;

  const envSnapshot = {
    SUPABASE_URL: supabaseUrl ? `${supabaseUrl.slice(0, 8)}...` : null,
    hasServiceRoleKey: Boolean(serviceKey && serviceKey.length > 20),
    WORKER_ID: process.env.WORKER_ID || null,
    PIPELINE_ID: process.env.PIPELINE_ID || null,
    WORKER_INSTANCE_ID: process.env.WORKER_INSTANCE_ID || null,
    HOSTNAME: process.env.HOSTNAME || null,
  };

  if (!supabaseUrl || !serviceKey) {
    console.log(JSON.stringify({ ok: false, error: 'missing_env', env: envSnapshot }, null, 2));
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const routing = {
    pipelineId,
    workerInstanceId,
    pollFilter: {
      statuses: ['queued', 'uploaded'],
      workerIdAllowed: [pipelineId, null],
      reclaimExpiredProcessing: true,
      leaseMs: 300000,
    },
  };

  const [{ data: recent, error: recentErr }, { data: queued, error: queuedErr }, { data: processing, error: procErr }] =
    await Promise.all([
      supabase
        .from('au_worker_jobs')
        .select('id,status,worker_id,claimed_by,locked_at,locked_until,progress,document_id,owner_id,user_id,object_path,created_at,updated_at')
        .order('updated_at', { ascending: false })
        .limit(25),
      supabase
        .from('au_worker_jobs')
        .select('id,status,worker_id,created_at', { count: 'exact' })
        .in('status', ['queued', 'uploaded'])
        .or(`worker_id.eq.${pipelineId},worker_id.is.null`)
        .limit(25),
      supabase
        .from('au_worker_jobs')
        .select('id,status,worker_id,claimed_by,locked_until,progress,created_at,updated_at', { count: 'exact' })
        .eq('status', 'processing')
        .order('updated_at', { ascending: false })
        .limit(25),
    ]);

  const payload = {
    ok: true,
    env: envSnapshot,
    routing,
    stats: {
      recentError: recentErr ? { message: recentErr.message, code: recentErr.code } : null,
      queuedError: queuedErr ? { message: queuedErr.message, code: queuedErr.code } : null,
      processingError: procErr ? { message: procErr.message, code: procErr.code } : null,
      queuedCount: queuedErr ? null : queued?.length ?? 0,
      processingCount: procErr ? null : processing?.length ?? 0,
    },
    recentJobs: recent || [],
    queuedCandidates: queued || [],
    processingJobs: processing || [],
  };

  console.log(JSON.stringify(payload, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
