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
import {
  enforceModelAccess,
  enforceProxyTierAccess,
  isTierGuardedFunction,
  TierAccessError,
} from '@/lib/server/tier-enforcement';

export const runtime = 'nodejs';

const BLOCKED_UPSTREAM_RESPONSE_HEADERS = new Set<string>([
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'vary',
]);

const SAFE_UPSTREAM_RESPONSE_HEADERS = new Set<string>([
  'content-type',
  'cache-control',
  'pragma',
  'expires',
  'etag',
  'last-modified',
  'retry-after',
  'content-disposition',
  'accept-ranges',
]);

type BodyRelayMode = 'empty' | 'stream' | 'json' | 'text' | 'binary';

class ProxyTimeoutError extends Error {
  timeoutMs: number;
  upstreamUrl: string;

  constructor(timeoutMs: number, upstreamUrl: string) {
    super(`Proxy upstream timeout after ${timeoutMs}ms`);
    this.name = 'ProxyTimeoutError';
    this.timeoutMs = timeoutMs;
    this.upstreamUrl = upstreamUrl;
  }
}

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

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw ?? '');
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function correlationIdFromBody(body: any): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const candidate =
    String(body?.correlationId || body?.correlation_id || body?.uploadId || body?.upload_id || body?.jobId || '')
      .trim();
  return candidate.length > 0 ? candidate : null;
}

function isProxyDebugEnabled(): boolean {
  return process.env.PROXY_DEBUG === '1';
}

function shouldForwardUpstreamHeader(name: string): boolean {
  const lower = name.toLowerCase();
  if (BLOCKED_UPSTREAM_RESPONSE_HEADERS.has(lower)) return false;
  if (SAFE_UPSTREAM_RESPONSE_HEADERS.has(lower)) return true;
  if (lower.startsWith('x-')) return true;
  return false;
}

function headersToObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function applyResponseHeaders(source: Headers, requestId: string): Headers {
  const headers = new Headers();
  source.forEach((value, key) => {
    if (!shouldForwardUpstreamHeader(key)) return;
    headers.set(key, value);
  });
  if (!headers.has('cache-control')) {
    headers.set('cache-control', 'no-store');
  }
  if (isProxyDebugEnabled()) {
    headers.set('x-proxy-debug', '1');
  }
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

function isTextContentType(contentType: string | null): boolean {
  const lower = String(contentType || '').toLowerCase();
  return (
    lower.startsWith('text/') ||
    lower.includes('application/xml') ||
    lower.includes('application/xhtml+xml') ||
    lower.includes('application/javascript') ||
    lower.includes('application/x-www-form-urlencoded')
  );
}

function toStructuredTierPayload(details: unknown): Record<string, unknown> | null {
  if (!details || typeof details !== 'object') return null;
  const row = details as any;
  const code = String(row?.error || row?.code || row?.error?.code || '').trim().toUpperCase();

  if (!code) return null;

  if (code === 'UPGRADE_REQUIRED' || code === 'PRO_REQUIRED') {
    const key = String(row?.key || row?.reason || 'pro_feature').toLowerCase();
    return {
      error: 'PRO_REQUIRED',
      key,
      message: String(row?.message || row?.reason || 'This feature requires Pro.'),
      upgrade: {
        cta: String(row?.upgrade?.cta || row?.cta || 'Upgrade to Pro'),
        href: String(row?.upgrade?.href || row?.upgradeUrl || `/pricing?source=feature_${encodeURIComponent(key)}`),
      },
    };
  }

  if (code === 'LIMIT_REACHED' || code === 'LIMIT_EXCEEDED') {
    const key = String(row?.key || row?.limit || 'unknown_limit');
    return {
      error: 'LIMIT_REACHED',
      key,
      message: String(row?.message || `Limit reached (${key}).`),
      used: typeof row?.used === 'number' ? row.used : row?.current,
      limit: typeof row?.limit === 'number' ? row.limit : row?.max,
      reset_at: row?.reset_at || row?.resetAt || null,
      upgrade: {
        cta: String(row?.upgrade?.cta || 'Upgrade to Pro'),
        href: String(row?.upgrade?.href || `/pricing?source=limit_${encodeURIComponent(key)}`),
      },
    };
  }

  return null;
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

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function forwardWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new ProxyTimeoutError(timeoutMs, url);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function relaySuccessfulResponse(
  response: Response,
  req: NextRequest,
  requestId: string,
  candidate: RoutingCandidate | null,
): Promise<{ response: Response; bodyMode: BodyRelayMode; forwardedHeaders: Headers }> {
  const outHeaders = withDebugHeaders(applyResponseHeaders(response.headers, requestId), candidate, req);
  const contentType = response.headers.get('content-type');
  const isEventStream = String(contentType || '').toLowerCase().includes('text/event-stream');

  if (isEventStream) {
    return {
      response: new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: outHeaders,
      }),
      bodyMode: 'stream',
      forwardedHeaders: outHeaders,
    };
  }

  if (req.method === 'HEAD' || response.status === 204 || response.status === 304) {
    return {
      response: new Response(null, {
        status: response.status,
        statusText: response.statusText,
        headers: outHeaders,
      }),
      bodyMode: 'empty',
      forwardedHeaders: outHeaders,
    };
  }

  const rawBuffer = Buffer.from(await response.arrayBuffer());
  if (rawBuffer.length === 0) {
    return {
      response: new Response(null, {
        status: response.status,
        statusText: response.statusText,
        headers: outHeaders,
      }),
      bodyMode: 'empty',
      forwardedHeaders: outHeaders,
    };
  }

  if (isJsonContentType(contentType)) {
    const text = rawBuffer.toString('utf8');
    const parsed = tryParseJson(text);
    if (parsed !== null) {
      outHeaders.set('Content-Type', 'application/json; charset=utf-8');
      return {
        response: NextResponse.json(parsed, {
          status: response.status,
          headers: outHeaders,
        }),
        bodyMode: 'json',
        forwardedHeaders: outHeaders,
      };
    }

    outHeaders.set('Content-Type', 'text/plain; charset=utf-8');
    return {
      response: new Response(text, {
        status: response.status,
        statusText: response.statusText,
        headers: outHeaders,
      }),
      bodyMode: 'text',
      forwardedHeaders: outHeaders,
    };
  }

  if (isTextContentType(contentType)) {
    outHeaders.set('Content-Type', contentType || 'text/plain; charset=utf-8');
    return {
      response: new Response(rawBuffer.toString('utf8'), {
        status: response.status,
        statusText: response.statusText,
        headers: outHeaders,
      }),
      bodyMode: 'text',
      forwardedHeaders: outHeaders,
    };
  }

  outHeaders.set('Content-Type', contentType || 'application/octet-stream');
  return {
    response: new Response(rawBuffer, {
      status: response.status,
      statusText: response.statusText,
      headers: outHeaders,
    }),
    bodyMode: 'binary',
    forwardedHeaders: outHeaders,
  };
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
  let correlationId = req.headers.get('x-correlation-id')?.trim() || requestId;
  const proxyDebugEnabled = isProxyDebugEnabled();
  const requestPath = req.nextUrl.pathname;
  const requestMethod = req.method;
  const startedAt = Date.now();
  const upstreamTimeoutMs = parsePositiveInt(process.env.PROXY_UPSTREAM_TIMEOUT_MS, 30000);

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

    console.info('[proxy] request received', {
      requestId,
      correlationId,
      method: requestMethod,
      path: requestPath,
      upstreamUrl: targetUrl.toString(),
      timeoutMs: upstreamTimeoutMs,
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
      if (rawBody.byteLength > 0 && isJsonContentType(contentType)) {
        rawBodyText = new TextDecoder().decode(rawBody);
      }
    }

    let parsedBody: any = {};
    if (rawBodyText.trim()) {
      try {
        parsedBody = JSON.parse(rawBodyText);
      } catch {
        parsedBody = {};
      }
    }

    const bodyCorrelationId = correlationIdFromBody(parsedBody);
    if (bodyCorrelationId) correlationId = bodyCorrelationId;
    headers.set('x-correlation-id', correlationId);

    if (routeWithModelSelector) {
      if (String(parsedBody?.action || '').toLowerCase() === 'get_models') {
        routeWithModelSelector = false;
      }
    }

    const needsTierGuards = isTierGuardedFunction(functionName);
    const supabase = needsTierGuards ? createSupabaseAdminClient() : null;
    let tierContext: any = null;
    let guardedBody = parsedBody;
    let appliedGuards: string[] = [];
    try {
      const guard = await enforceProxyTierAccess({
        supabase,
        userId: auth.userId,
        functionName,
        method: req.method,
        body: parsedBody,
        requestPath: `/api/proxy/${functionName}`,
      });
      tierContext = guard.tierContext;
      guardedBody = guard.body;
      appliedGuards = guard.appliedGuards;
    } catch (error: any) {
      if (error instanceof TierAccessError) {
        const payload = error.payload || { error: 'tier_access_denied', message: error.message };
        return NextResponse.json(payload, { status: error.status, headers: corsHeaders(requestId) });
      }
      throw error;
    }

    console.info('[tier-access]', JSON.stringify({
      requestId,
      userId: auth.userId,
      functionName,
      requestType: requestType || 'other',
      tier: tierContext?.tier || 'FREE',
      plan: tierContext?.planForRouting || 'free',
      guards: appliedGuards,
    }));

    const forwardOnce = async (attemptHeaders: Headers, attemptBody?: BodyInit) => {
      return forwardWithTimeout(targetUrl.toString(), {
        method: req.method,
        headers: attemptHeaders,
        body: attemptBody,
      }, upstreamTimeoutMs);
    };

    const failFromResponse = async (response: Response, candidate: RoutingCandidate | null) => {
      const { details, raw } = await parseErrorPayload(response);
      const message = messageFromFailure(response.status, details, response.statusText);
      console.error('[proxy] edge function failed', {
        requestId,
        correlationId,
        functionName,
        userId: auth.userId,
        status: response.status,
        message,
        errorBody: truncateForLog(raw || details),
        routedModel: candidate?.model || null,
        routedService: candidate?.service || null,
      });

      const outHeaders = withDebugHeaders(applyResponseHeaders(response.headers, requestId), candidate, req);
      const retryAfter = response.headers.get('retry-after');
      if (retryAfter) outHeaders.set('retry-after', retryAfter);
      if (proxyDebugEnabled) {
        console.info('[proxy] upstream non-2xx', {
          requestId,
          method: requestMethod,
          path: requestPath,
          upstreamUrl: targetUrl.toString(),
          upstreamStatus: response.status,
          upstreamHeaders: headersToObject(response.headers),
          forwardedHeaders: headersToObject(outHeaders),
          bodyMode: 'buffered-error-text',
          elapsedMs: Date.now() - startedAt,
        });
      } else {
        console.info('[proxy] upstream non-2xx', {
          requestId,
          method: requestMethod,
          path: requestPath,
          upstreamUrl: targetUrl.toString(),
          upstreamStatus: response.status,
          forwardedHeaderKeys: Array.from(outHeaders.keys()),
          bodyMode: 'buffered-error-text',
          elapsedMs: Date.now() - startedAt,
        });
      }
      const structured = toStructuredTierPayload(details);
      if (structured && (response.status === 402 || response.status === 429)) {
        return NextResponse.json(structured, { status: response.status, headers: outHeaders });
      }

      return NextResponse.json(
        {
          message,
          error: message,
          status: response.status,
          requestId,
          correlation_id: correlationId,
          details,
        },
        { status: response.status, headers: outHeaders },
      );
    };

    if (routeWithModelSelector) {
      const plan = tierContext?.planForRouting || 'free';
      if (!supabase) {
        throw new Error('Routing requires a Supabase admin client, but none was initialized.');
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
        try {
          enforceModelAccess({
            tierContext,
            model: candidate.model,
            strictFreeMode: candidate.flags.tierSplitEnabled,
          });
        } catch (error: any) {
          if (error instanceof TierAccessError) {
            return NextResponse.json(error.payload, { status: error.status, headers: corsHeaders(requestId) });
          }
          throw error;
        }

        const attemptHeaders = new Headers(headers);
        attemptHeaders.set('x-au-model', candidate.model);
        attemptHeaders.set('x-au-service', candidate.service);
        attemptHeaders.set('x-au-tier', candidate.tierWanted);
        attemptHeaders.set('x-au-openrouter-key', candidate.apiKey);

        const payload = {
          ...(guardedBody && typeof guardedBody === 'object' ? guardedBody : {}),
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
            const relay = await relaySuccessfulResponse(response, req, requestId, candidate);
            if (proxyDebugEnabled) {
              console.info('[proxy] upstream success', {
                requestId,
                correlationId,
                method: requestMethod,
                path: requestPath,
                upstreamUrl: targetUrl.toString(),
                upstreamStatus: response.status,
                upstreamHeaders: headersToObject(response.headers),
                forwardedHeaders: headersToObject(relay.forwardedHeaders),
                bodyMode: relay.bodyMode,
                elapsedMs: Date.now() - startedAt,
              });
            } else {
              console.info('[proxy] upstream success', {
                requestId,
                correlationId,
                method: requestMethod,
                path: requestPath,
                upstreamUrl: targetUrl.toString(),
                upstreamStatus: response.status,
                forwardedHeaderKeys: Array.from(relay.forwardedHeaders.keys()),
                bodyMode: relay.bodyMode,
                elapsedMs: Date.now() - startedAt,
              });
            }
            return relay.response;
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
          correlation_id: correlationId,
          details: { reason: 'No candidate succeeded.' },
        },
        { status: 503, headers: corsHeaders(requestId) },
      );
    }

    let forwardBody: BodyInit | undefined = rawBody && rawBody.byteLength > 0 ? rawBody : undefined;
    if (req.method !== 'GET' && req.method !== 'HEAD' && isJsonContentType(contentType)) {
      forwardBody = JSON.stringify(
        guardedBody && typeof guardedBody === 'object' ? guardedBody : {}
      );
    }

    const response = await forwardOnce(headers, forwardBody);
    const contentTypeResponse = String(response.headers.get('content-type') || '').toLowerCase();
    const isEventStream = contentTypeResponse.includes('text/event-stream');

    if (!response.ok && !isEventStream) {
      return failFromResponse(response, null);
    }

    const relay = await relaySuccessfulResponse(response, req, requestId, null);
    if (proxyDebugEnabled) {
      console.info('[proxy] upstream success', {
        requestId,
        correlationId,
        method: requestMethod,
        path: requestPath,
        upstreamUrl: targetUrl.toString(),
        upstreamStatus: response.status,
        upstreamHeaders: headersToObject(response.headers),
        forwardedHeaders: headersToObject(relay.forwardedHeaders),
        bodyMode: relay.bodyMode,
        elapsedMs: Date.now() - startedAt,
      });
    } else {
      console.info('[proxy] upstream success', {
        requestId,
        correlationId,
        method: requestMethod,
        path: requestPath,
        upstreamUrl: targetUrl.toString(),
        upstreamStatus: response.status,
        forwardedHeaderKeys: Array.from(relay.forwardedHeaders.keys()),
        bodyMode: relay.bodyMode,
        elapsedMs: Date.now() - startedAt,
      });
    }
    return relay.response;
  } catch (error: any) {
    if (error instanceof ProxyTimeoutError) {
      console.error('[proxy] upstream timeout', {
        requestId,
        functionName,
        method: requestMethod,
        path: requestPath,
        upstreamUrl: error.upstreamUrl,
        timeoutMs: error.timeoutMs,
        elapsedMs: Date.now() - startedAt,
      });
      return NextResponse.json(
        {
          message: 'upstream_timeout',
          error: 'upstream_timeout',
          status: 504,
          requestId,
          correlation_id: correlationId,
          details: {
            timeoutMs: error.timeoutMs,
            upstreamUrl: error.upstreamUrl,
          },
        },
        { status: 504, headers: corsHeaders(requestId) },
      );
    }

    const message = String(error?.message || 'Unknown error');
    console.error('[proxy] unexpected error', {
      requestId,
      correlationId,
      functionName,
      method: requestMethod,
      path: requestPath,
      upstreamUrl: functionsBaseUrl() ? `${functionsBaseUrl()}/${functionName}` : null,
      message,
      elapsedMs: Date.now() - startedAt,
    });
    return NextResponse.json(
      {
        message: 'internal_server_error',
        error: 'internal_server_error',
        status: 500,
        requestId,
        correlation_id: correlationId,
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
