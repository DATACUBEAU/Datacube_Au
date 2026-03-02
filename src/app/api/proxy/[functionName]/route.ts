import { NextRequest, NextResponse } from 'next/server';
import { requireUserFromRequest } from '@/app/api/proxy/_supabase-auth';
import {
  buildRoutingCandidates,
  logRoutingDecision,
  noteRoutingFailure,
  noteRoutingSuccess,
  type RoutingCandidate,
  type RoutingRequestType,
  ModelRoutingError,
} from '@/lib/server/ai-routing';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { getProEntitlementStatus } from '@/lib/server/entitlements';

export const runtime = 'nodejs';

function firstEnv(...keys: string[]): string | null {
  for (const key of keys) {
    const value = process.env[key];
    if (value && value.trim().length > 0) return value;
  }
  return null;
}

function functionsBaseUrl(): string | null {
  const supabaseUrl = firstEnv('NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL');
  if (!supabaseUrl) return null;
  return `${supabaseUrl.replace(/\/$/, '')}/functions/v1`;
}

function corsHeaders(requestId?: string): HeadersInit {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, apikey, x-admin-token',
  };
  if (requestId) headers['x-request-id'] = requestId;
  return headers;
}

function applyResponseHeaders(source: Headers, requestId: string): Headers {
  const headers = new Headers(source);
  Object.entries(corsHeaders(requestId)).forEach(([key, value]) => headers.set(key, String(value)));
  return headers;
}

function truncateForLog(value: unknown, limit = 1000): string {
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  if (!raw) return '';
  return raw.length > limit ? `${raw.slice(0, limit)}...` : raw;
}

function tryParseJson(raw: string): any | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function parseErrorPayload(response: Response): Promise<{ details: unknown; raw: string }> {
  const raw = await response.text().catch(() => '');
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('application/json')) {
    const parsed = tryParseJson(raw);
    return { details: parsed ?? raw, raw };
  }
  return { details: raw, raw };
}

function messageFromFailure(status: number, details: unknown, statusText: string): string {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';

  if (details && typeof details === 'object') {
    const candidate =
      (details as any).message ||
      (details as any).error ||
      (details as any).code;
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  if (typeof details === 'string' && details.trim()) {
    return details.trim().slice(0, 300);
  }

  return statusText || 'edge_function_error';
}

function isJsonContentType(contentType: string | null): boolean {
  return String(contentType || '').toLowerCase().includes('application/json');
}

function getRequestTypeForFunction(functionName: string): RoutingRequestType | null {
  const normalized = String(functionName || '').trim().toLowerCase();
  if (normalized === 'au-chat' || normalized === 'chat') return 'chat';
  if (normalized === 'global-chat') return 'global_chat';
  if (normalized === 'prediction-engine' || normalized === 'generate-exam-predictions') return 'prediction_engine';
  if (normalized === 'exam-generator' || normalized === 'generate-practice-exam') return 'exam_generator';
  if (normalized === 'generate-knowledge') return 'knowledge';
  return null;
}

function withDebugHeaders(
  headers: Headers,
  candidate: RoutingCandidate | null,
  request: NextRequest
): Headers {
  if (!candidate) return headers;
  const isAdminDebug = Boolean(request.headers.get('x-admin-token'));
  const allowDebug = process.env.NODE_ENV !== 'production' || isAdminDebug;
  if (!allowDebug) return headers;

  headers.set('x-au-model', candidate.model);
  headers.set('x-au-service', candidate.service);
  headers.set('x-au-tier', candidate.tierWanted);
  return headers;
}

async function getUserPlan(userId: string): Promise<string> {
  const supabase = createSupabaseAdminClient();
  const entitlement = await getProEntitlementStatus(supabase, userId).catch(() => null);
  if (entitlement?.hasPro) return 'pro';

  const { data, error } = await supabase
    .from('au_user_profiles')
    .select('tier')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    console.warn('[proxy] failed to load user plan, defaulting to free', {
      userId,
      message: error.message,
    });
    return 'free';
  }
  return String((data as any)?.tier || 'free');
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeRoutingAudit(
  userId: string,
  plan: string,
  requestType: RoutingRequestType,
  candidate: RoutingCandidate
) {
  try {
    const supabase = createSupabaseAdminClient();
    await supabase.from('ai_routing_audit').insert({
      user_id: userId,
      plan,
      request_type: requestType,
      tier_wanted: candidate.tierWanted,
      service: candidate.service,
      model: candidate.model,
      tier_split_enabled: candidate.flags.tierSplitEnabled,
      metadata: {
        request_source: 'next_proxy',
      },
    });
  } catch {
    // Audit persistence is best-effort.
  }
}

async function proxyRequest(req: NextRequest, { params }: { params: Promise<{ functionName: string }> }) {
  const { functionName } = await params;
  const requestId = crypto.randomUUID();

  try {
    const baseUrl = functionsBaseUrl();
    const anonKey = firstEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY');
    if (!baseUrl || !anonKey) {
      return NextResponse.json(
        {
          message: 'server_misconfigured',
          error: 'server_misconfigured',
          status: 503,
          requestId,
          details: {
            missing: [
              !baseUrl ? 'SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL' : null,
              !anonKey ? 'NEXT_PUBLIC_SUPABASE_ANON_KEY or SUPABASE_ANON_KEY' : null,
            ].filter(Boolean),
          },
        },
        { status: 503, headers: corsHeaders(requestId) },
      );
    }

    const auth = await requireUserFromRequest(req);
    if (!auth.ok) {
      console.warn('[proxy] unauthorized request', {
        requestId,
        functionName,
        reason: auth.reason,
      });
      return NextResponse.json(
        {
          message: 'unauthorized',
          error: 'unauthorized',
          status: 401,
          requestId,
          details: { reason: auth.reason },
        },
        { status: 401, headers: corsHeaders(requestId) },
      );
    }

    const incomingUrl = new URL(req.url);
    const targetUrl = new URL(`${baseUrl}/${functionName}`);
    incomingUrl.searchParams.forEach((value, key) => {
      targetUrl.searchParams.append(key, value);
    });

    const headers = new Headers();
    headers.set('Authorization', `Bearer ${auth.accessToken}`);
    headers.set('apikey', anonKey);

    const contentType = req.headers.get('content-type');
    if (contentType) headers.set('Content-Type', contentType);

    const accept = req.headers.get('accept');
    if (accept) headers.set('Accept', accept);

    const passthroughHeaders = [
      'x-admin-token',
      'x-client-info',
      'x-device-id',
      'x-supabase-client-platform',
      'tus-resumable',
      'upload-length',
      'upload-metadata',
      'upload-offset',
    ];
    passthroughHeaders.forEach((name) => {
      const value = req.headers.get(name);
      if (value) headers.set(name, value);
    });

    const requestType = getRequestTypeForFunction(functionName);
    let routeWithModelSelector =
      requestType !== null &&
      req.method === 'POST' &&
      isJsonContentType(contentType);

    let rawBody: ArrayBuffer | null = null;
    let rawBodyText = '';
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      rawBody = await req.arrayBuffer();
      if (rawBody.byteLength > 0 && routeWithModelSelector) {
        rawBodyText = new TextDecoder().decode(rawBody);
        try {
          const preview = JSON.parse(rawBodyText);
          if (String(preview?.action || '').toLowerCase() === 'get_models') {
            routeWithModelSelector = false;
          }
        } catch {
        }
      }
    }

    const forwardOnce = async (attemptHeaders: Headers, attemptBody?: BodyInit) => {
      return fetch(targetUrl.toString(), {
        method: req.method,
        headers: attemptHeaders,
        body: attemptBody,
      });
    };

    const failFromResponse = async (response: Response, candidate: RoutingCandidate | null) => {
      const { details, raw } = await parseErrorPayload(response);
      const message = messageFromFailure(response.status, details, response.statusText);
      console.error('[proxy] edge function failed', {
        requestId,
        functionName,
        userId: auth.userId,
        status: response.status,
        message,
        errorBody: truncateForLog(raw || details),
        routedModel: candidate?.model || null,
        routedService: candidate?.service || null,
      });

      const outHeaders = new Headers(corsHeaders(requestId));
      const retryAfter = response.headers.get('retry-after');
      if (retryAfter) outHeaders.set('retry-after', retryAfter);
      const debugHeaders = withDebugHeaders(outHeaders, candidate, req);

      return NextResponse.json(
        {
          message,
          error: message,
          status: response.status,
          requestId,
          details,
        },
        { status: response.status, headers: debugHeaders },
      );
    };

    if (routeWithModelSelector) {
      const supabase = createSupabaseAdminClient();
      const plan = await getUserPlan(auth.userId);

      let parsedBody: any = {};
      if (rawBodyText.trim()) {
        try {
          parsedBody = JSON.parse(rawBodyText);
        } catch {
          parsedBody = {};
        }
      }

      let routed;
      try {
        routed = await buildRoutingCandidates({
          supabase,
          userId: auth.userId,
          plan,
          requestType: requestType!,
        });
      } catch (error: any) {
        if (error instanceof ModelRoutingError) {
          return NextResponse.json(
            {
              message: error.message,
              error: error.code,
              status: error.status,
              requestId,
              details: error.details || {},
            },
            { status: error.status, headers: corsHeaders(requestId) },
          );
        }
        throw error;
      }

      let lastFailure: { response: Response; candidate: RoutingCandidate } | null = null;
      for (const candidate of routed.candidates) {
        const attemptHeaders = new Headers(headers);
        attemptHeaders.set('x-au-model', candidate.model);
        attemptHeaders.set('x-au-service', candidate.service);
        attemptHeaders.set('x-au-tier', candidate.tierWanted);
        attemptHeaders.set('x-au-openrouter-key', candidate.apiKey);

        const payload = {
          ...(parsedBody && typeof parsedBody === 'object' ? parsedBody : {}),
          model: candidate.model,
        };
        const attemptBody = JSON.stringify(payload);

        logRoutingDecision({
          requestType: requestType!,
          userId: auth.userId,
          plan,
          candidate,
        });
        await writeRoutingAudit(auth.userId, plan, requestType!, candidate);

        for (let localAttempt = 0; localAttempt < 2; localAttempt += 1) {
          const response = await forwardOnce(attemptHeaders, attemptBody);
          const contentTypeResponse = String(response.headers.get('content-type') || '').toLowerCase();
          const isEventStream = contentTypeResponse.includes('text/event-stream');
          if (response.ok || (isEventStream && response.status < 400)) {
            try {
              await noteRoutingSuccess(supabase, candidate);
            } catch {
            }
            const outHeaders = applyResponseHeaders(response.headers, requestId);
            const debugHeaders = withDebugHeaders(outHeaders, candidate, req);
            return new Response(response.body, {
              status: response.status,
              statusText: response.statusText,
              headers: debugHeaders,
            });
          }

          const status = Number(response.status || 500);
          const retryAfter = response.headers.get('retry-after');
          try {
            await noteRoutingFailure(supabase, candidate, status, retryAfter);
          } catch {
          }

          const retryable = status === 429 || status >= 500 || status === 408;
          if (retryable && localAttempt === 0) {
            const waitMs = status === 429 ? 600 : 350;
            await wait(waitMs);
            lastFailure = { response, candidate };
            continue;
          }

          if (retryable) {
            lastFailure = { response, candidate };
            break;
          }

          return failFromResponse(response, candidate);
        }
      }

      if (lastFailure) {
        return failFromResponse(lastFailure.response, lastFailure.candidate);
      }

      return NextResponse.json(
        {
          message: 'routing_failed',
          error: 'routing_failed',
          status: 503,
          requestId,
          details: { reason: 'No candidate succeeded.' },
        },
        { status: 503, headers: corsHeaders(requestId) },
      );
    }

    const body = rawBody && rawBody.byteLength > 0 ? rawBody : undefined;
    const response = await forwardOnce(headers, body);
    const contentTypeResponse = String(response.headers.get('content-type') || '').toLowerCase();
    const isEventStream = contentTypeResponse.includes('text/event-stream');

    if (!response.ok && !isEventStream) {
      return failFromResponse(response, null);
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: applyResponseHeaders(response.headers, requestId),
    });
  } catch (error: any) {
    const message = String(error?.message || 'Unknown error');
    console.error('[proxy] unexpected error', {
      requestId,
      functionName,
      message,
    });
    return NextResponse.json(
      {
        message: 'internal_server_error',
        error: 'internal_server_error',
        status: 500,
        requestId,
        details: truncateForLog(message),
      },
      { status: 500, headers: corsHeaders(requestId) },
    );
  }
}

export async function GET(req: NextRequest, props: { params: Promise<{ functionName: string }> }) {
  return proxyRequest(req, props);
}

export async function POST(req: NextRequest, props: { params: Promise<{ functionName: string }> }) {
  return proxyRequest(req, props);
}

export async function OPTIONS(_req: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: corsHeaders(),
  });
}
