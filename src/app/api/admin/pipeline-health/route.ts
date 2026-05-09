import { NextRequest, NextResponse } from 'next/server';
import { requireConexAdmin } from '@/app/api/feedback/_auth';
import { randomUUID } from 'crypto';

export const runtime = 'nodejs';

/**
 * VPS Pipeline Health Check — admin-only endpoint.
 *
 * Checks connectivity and health of the full upload/ingestion pipeline:
 *   1. Supabase DB connectivity (au_documents, au_worker_jobs, au_config)
 *   2. Supabase Storage (bucket accessible)
 *   3. VPS AI Gateway reachability
 *   4. Ingestion queue health (pending/stuck jobs)
 *
 * Returns structured diagnostics the admin panel can display.
 */
export async function POST(req: NextRequest) {
  const requestId = randomUUID();
  const adminResult = await requireConexAdmin(req);
  if (!adminResult.ok) return adminResult.response;

  const supabase = adminResult.supabase;
  const checks: Record<string, {
    ok: boolean;
    latencyMs: number;
    error?: string;
    details?: any;
  }> = {};

  // 1. Supabase DB — au_documents table
  const t0 = Date.now();
  const { error: docsErr, count: docCount } = await supabase
    .from('au_documents')
    .select('id', { count: 'exact', head: true });
  checks.database_documents = {
    ok: !docsErr,
    latencyMs: Date.now() - t0,
    error: docsErr?.message,
    details: docsErr ? { code: docsErr.code, hint: docsErr.hint } : { totalDocuments: docCount },
  };

  // 2. Supabase DB — au_worker_jobs table
  const t1 = Date.now();
  const { error: jobsErr, data: jobStats } = await supabase
    .from('au_worker_jobs')
    .select('status')
    .limit(500);
  const jobStatusCounts: Record<string, number> = {};
  if (jobStats) {
    for (const job of jobStats) {
      const s = String(job.status || 'unknown');
      jobStatusCounts[s] = (jobStatusCounts[s] || 0) + 1;
    }
  }
  checks.database_worker_jobs = {
    ok: !jobsErr,
    latencyMs: Date.now() - t1,
    error: jobsErr?.message,
    details: jobsErr
      ? { code: jobsErr.code }
      : { statusDistribution: jobStatusCounts, totalJobs: jobStats?.length || 0 },
  };

  // 3. Supabase DB — au_config table
  const t2 = Date.now();
  const { error: configErr, data: configData } = await supabase
    .from('au_config')
    .select('id,billing_enabled')
    .limit(1)
    .maybeSingle();
  checks.database_config = {
    ok: !configErr,
    latencyMs: Date.now() - t2,
    error: configErr?.message,
    details: configErr
      ? { code: configErr.code }
      : { hasConfig: !!configData, billingEnabled: configData?.billing_enabled },
  };

  // 4. Supabase Storage — bucket accessible
  const bucketName = process.env.NEXT_PUBLIC_SUPABASE_BUCKET || 'documents';
  const t3 = Date.now();
  try {
    const { data: bucketData, error: bucketErr } = await supabase.storage.getBucket(bucketName);
    checks.storage_bucket = {
      ok: !bucketErr && !!bucketData,
      latencyMs: Date.now() - t3,
      error: bucketErr?.message,
      details: {
        bucketName,
        public: bucketData?.public ?? null,
      },
    };
  } catch (e: any) {
    checks.storage_bucket = {
      ok: false,
      latencyMs: Date.now() - t3,
      error: e?.message || 'Bucket check failed',
    };
  }

  // 5. VPS AI Gateway reachability
  const gatewayUrl = process.env.VPS_GATEWAY_URL || process.env.NEXT_PUBLIC_VPS_GATEWAY_URL;
  if (gatewayUrl) {
    const healthUrl = gatewayUrl.replace(/\/$/, '') + '/health';
    const t4 = Date.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(healthUrl, {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const body = await res.json().catch(() => ({}));
      checks.vps_gateway = {
        ok: res.ok,
        latencyMs: Date.now() - t4,
        error: res.ok ? undefined : `HTTP ${res.status}`,
        details: {
          url: healthUrl,
          status: res.status,
          ...body,
        },
      };
    } catch (e: any) {
      checks.vps_gateway = {
        ok: false,
        latencyMs: Date.now() - t4,
        error: e?.message || 'Gateway unreachable',
        details: { url: healthUrl },
      };
    }
  } else {
    checks.vps_gateway = {
      ok: false,
      latencyMs: 0,
      error: 'VPS_GATEWAY_URL not configured',
      details: { envVars: ['VPS_GATEWAY_URL', 'NEXT_PUBLIC_VPS_GATEWAY_URL'] },
    };
  }

  // 6. Stuck jobs analysis
  const t5 = Date.now();
  const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { data: stuckJobs, error: stuckErr } = await supabase
    .from('au_worker_jobs')
    .select('id, status, created_at, updated_at')
    .in('status', ['queued', 'processing', 'uploading'])
    .lt('updated_at', fifteenMinAgo)
    .limit(20);
  checks.ingestion_queue = {
    ok: !stuckErr && (!stuckJobs || stuckJobs.length === 0),
    latencyMs: Date.now() - t5,
    error: stuckErr?.message,
    details: {
      stuckJobCount: stuckJobs?.length || 0,
      stuckJobs: stuckJobs?.map(j => ({
        id: j.id,
        status: j.status,
        createdAt: j.created_at,
        updatedAt: j.updated_at,
      })) || [],
    },
  };

  // 7. Schema cache test — verify bucket column exists on au_documents
  const t6 = Date.now();
  const { error: schemaErr } = await supabase
    .from('au_documents')
    .select('id, bucket, file_path, file_size_bytes')
    .limit(1);
  checks.schema_columns = {
    ok: !schemaErr,
    latencyMs: Date.now() - t6,
    error: schemaErr?.message,
    details: schemaErr
      ? {
          code: schemaErr.code,
          hint: 'Run the latest migration and reload schema cache',
        }
      : { verified: ['id', 'bucket', 'file_path', 'file_size_bytes'] },
  };

  const allOk = Object.values(checks).every(c => c.ok);
  const totalLatency = Object.values(checks).reduce((sum, c) => sum + c.latencyMs, 0);

  const status = allOk ? 'GREEN' : Object.values(checks).some(c => !c.ok && c.error?.includes('unreachable')) ? 'RED' : 'YELLOW';

  return NextResponse.json(
    {
      status,
      allOk,
      totalLatencyMs: totalLatency,
      checks,
      requestId,
      timestamp: new Date().toISOString(),
    },
    {
      status: allOk ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
