import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';
import {
  DEFAULT_READINESS_TIMEOUT_MS,
  runReadinessProbe,
} from '@/lib/server/health-readiness';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getReadinessTimeoutMs(): number {
  const parsed = Number(process.env.HEALTH_READINESS_TIMEOUT_MS || '');
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_READINESS_TIMEOUT_MS;
  }
  return Math.floor(parsed);
}

export async function GET() {
  const requestId = crypto.randomUUID();
  const result = await runReadinessProbe({
    timeoutMs: getReadinessTimeoutMs(),
    check: async (signal) => {
      const supabase = createSupabaseAdminClient();
      const { error } = await supabase
        .from('feature_flags')
        .select('key')
        .limit(1)
        .abortSignal(signal);

      if (error) {
        throw new Error('datastore_unavailable');
      }
    },
  });

  if (!result.ok) {
    console.warn('Datastore readiness check degraded', {
      requestId,
      dependency: result.dependency,
      durationMs: result.durationMs,
    });
  }

  return Response.json(
    {
      ok: result.ok,
      status: result.ok ? 'ready' : 'degraded',
      checks: {
        database: result.dependency,
      },
      duration_ms: result.durationMs,
      request_id: requestId,
      ts: Date.now(),
    },
    {
      status: result.ok ? 200 : 503,
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    },
  );
}
