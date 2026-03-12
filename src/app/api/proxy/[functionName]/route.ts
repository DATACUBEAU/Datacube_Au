import { NextRequest, NextResponse } from 'next/server';
import { requireUserFromRequest } from '@/app/api/proxy/_supabase-auth';
import {
  buildRoutingCandidates,
  getAllowedPaidModelsForProvider,
  getDefaultPaidModel,
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
import {
  redactChatPayloadForLog,
  toLegacyEdgePayload,
  validateAndNormalizeChatPayload,
  type CanonicalChatPayload,
} from '@shared/chat-payload';
import {
  buildAnswerCacheKey,
  buildDocScope,
  buildIdempotencyStorageKey,
  buildSettingsHash,
  classifyTemplateResponse,
  getFeatureGateDecision,
  markFeatureOutputFailed,
  markFeatureOutputReady,
  normalizeQuestion,
  prepareFeatureOutputGeneration,
  readAnswerCache,
  readIdempotencyRecord,
  recordSyntheticUsage,
  resolveDocumentVersion,
  sha256Hex,
  touchAnswerCacheHit,
  writeAnswerCache,
  writeIdempotencyRecord,
} from '@/lib/server/ai-governance';
import {
  EffectiveLimitError,
  getEffectiveLimits,
  throwChatLimitIfNeeded,
  throwExamLimitIfNeeded,
  throwIngestLimitIfNeeded,
  throwUploadLimitIfNeeded,
} from '@/lib/server/au-limits';

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

function inferJsonPayload(raw: string): any | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const first = trimmed[0];
  const looksJson =
    first === '{' ||
    first === '[' ||
    first === '"' ||
    first === '-' ||
    (first >= '0' && first <= '9') ||
    first === 't' ||
    first === 'f' ||
    first === 'n';

  if (!looksJson) return null;
  return tryParseJson(trimmed);
}

async function parseErrorPayload(response: Response): Promise<{ details: unknown; raw: string }> {
  const raw = await response.text().catch(() => '');
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  const parsed = inferJsonPayload(raw);
  if (contentType.includes('application/json') || parsed !== null) {
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

function cacheFeatureForFunction(functionName: string): string | null {
  const normalized = String(functionName || '').trim().toLowerCase();
  if (normalized === 'au-chat' || normalized === 'chat' || normalized === 'global-chat') return 'chat';
  if (normalized === 'generate-knowledge') return 'knowledge_hub';
  if (normalized === 'prediction-engine' || normalized === 'generate-exam-predictions') return 'exam_prediction';
  if (normalized === 'exam-generator' || normalized === 'generate-practice-exam') return 'practice_exam_generation';
  return null;
}

function buildPlanGatePayload(params: {
  status?: number;
  code: string;
  key: string;
  message: string;
  correlationId: string;
}): Record<string, unknown> {
  return {
    status: params.status || 403,
    code: params.code,
    key: params.key,
    limit: params.key,
    message: params.message,
    action: params.key,
    current: 0,
    correlation_id: params.correlationId,
    upgrade: {
      cta: 'Upgrade to Pro',
      href: `/pricing?source=feature_${encodeURIComponent(params.key)}`,
    },
  };
}

function latestUserMessage(payload: CanonicalChatPayload | null): string {
  if (!payload) return '';
  for (let index = payload.messages.length - 1; index >= 0; index -= 1) {
    if (payload.messages[index]?.role === 'user') {
      return String(payload.messages[index]?.content || '').trim();
    }
  }
  return '';
}

function extractDocumentIdForFeature(functionName: string, body: any): string | null {
  const normalized = String(functionName || '').trim().toLowerCase();
  if (normalized === 'generate-knowledge' || normalized === 'exam-generator' || normalized === 'generate-practice-exam') {
    return String(body?.documentId || body?.document_id || '').trim() || null;
  }
  if (normalized === 'prediction-engine' || normalized === 'generate-exam-predictions') {
    return String(
      body?.documentId ||
      body?.document_id ||
      body?.mainTextbookId ||
      body?.main_textbook_id ||
      body?.textbookId ||
      '',
    ).trim() || null;
  }
  return null;
}

function buildFeatureSourceTexts(functionName: string, body: any): Array<string | null | undefined> {
  const normalized = String(functionName || '').trim().toLowerCase();
  if (normalized === 'generate-knowledge') {
    return [body?.documentContent, body?.pastQuestionsContent];
  }
  if (normalized === 'prediction-engine' || normalized === 'generate-exam-predictions') {
    return [body?.mainTextbookContent, body?.pastQuestionsContent];
  }
  if (normalized === 'exam-generator' || normalized === 'generate-practice-exam') {
    return [body?.documentContent, body?.pastQuestionsContent];
  }
  return [];
}

async function parseJsonClone(response: Response): Promise<any | null> {
  const raw = await response.clone().text().catch(() => '');
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('application/json')) {
    return inferJsonPayload(raw);
  }
  return inferJsonPayload(raw);
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

  const text = rawBuffer.toString('utf8');
  const parsed = inferJsonPayload(text);
  if (isJsonContentType(contentType) || parsed !== null) {
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
  let reservationUserId = '';
  let reservationSupabase: ReturnType<typeof createSupabaseAdminClient> | null = null;
  let featureOutputReservation:
    | {
        feature: 'knowledge_hub' | 'exam_prediction' | 'practice_exam_generation';
        docVersionId: string;
      }
    | null = null;

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
    reservationUserId = auth.userId;

    const adminSupabase = createSupabaseAdminClient();
    reservationSupabase = adminSupabase;

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

    const normalizedFunction = String(functionName || '').trim().toLowerCase();
    let parsedBody: any = {};
    let canonicalChatPayload: CanonicalChatPayload | null = null;
    let chatIdempotencyStorageKey: string | null = null;
    let chatAnswerCacheKey: string | null = null;
    let chatRequestHash: string | null = null;
    let chatNormalizedQuestion = '';
    let chatActiveDocScope = '';
    let chatSettingsHash = '';
    let chatRuntimeFeature = normalizedFunction === 'global-chat' ? 'global_chat' : 'doc_chat';
    let featureOutputContext:
      | {
          feature: 'knowledge_hub' | 'exam_prediction' | 'practice_exam_generation';
          documentId: string;
          docVersionId: string | null;
        }
      | null = null;
    if (rawBodyText.trim()) {
      try {
        parsedBody = JSON.parse(rawBodyText);
      } catch {
        parsedBody = {};
      }
    }

    const shouldNormalizeChatPayload =
      req.method === 'POST' &&
      isJsonContentType(contentType) &&
      (normalizedFunction === 'global-chat' || normalizedFunction === 'au-chat' || normalizedFunction === 'chat');
    const isModelsAction = String(parsedBody?.action || '').trim().toLowerCase() === 'get_models';

    if (shouldNormalizeChatPayload && !isModelsAction) {
      const validation = validateAndNormalizeChatPayload(parsedBody);
      const normalizedCorrelation =
        validation.success
          ? validation.data.correlationId
          : validation.normalized.correlationId;
      if (normalizedCorrelation) {
        correlationId = normalizedCorrelation;
      }

      if (!validation.success) {
        console.warn('[proxy] chat payload validation failed', {
          requestId,
          correlationId,
          functionName,
          issues: validation.issues,
        });
        return NextResponse.json(
          {
            message: 'Invalid Payload',
            error: 'Invalid Payload',
            status: 400,
            requestId,
            correlation_id: correlationId,
            details: {
              issues: validation.issues,
            },
          },
          { status: 400, headers: corsHeaders(requestId) },
        );
      }

      const mode = normalizedFunction === 'global-chat' ? 'global' : 'doc';
      canonicalChatPayload = validation.data;
      chatRuntimeFeature = validation.data.feature || (mode === 'global' ? 'global_chat' : 'doc_chat');
      const extras: Record<string, unknown> = {
        action: parsedBody?.action,
        summaryMode: parsedBody?.summaryMode,
        browsingMode: parsedBody?.browsingMode,
        app_context: parsedBody?.app_context,
        memory_pack: parsedBody?.memory_pack,
        document_context: parsedBody?.document_context,
        recent_snippet: parsedBody?.recent_snippet,
        secondary_snippet: parsedBody?.secondary_snippet,
        retrieval: parsedBody?.retrieval,
        au_handoff_hint: parsedBody?.au_handoff_hint,
        model: parsedBody?.model,
        clientMessageId: parsedBody?.clientMessageId,
        policyVersion: parsedBody?.policyVersion,
        memory: parsedBody?.memory,
      };

      parsedBody = toLegacyEdgePayload(validation.data, mode, extras);

      console.info('[proxy] normalized chat payload', {
        requestId,
        correlationId,
        functionName,
        payload: redactChatPayloadForLog(validation.data),
      });
    }

    const bodyCorrelationId = correlationIdFromBody(parsedBody);
    if (bodyCorrelationId) correlationId = bodyCorrelationId;
    headers.set('x-correlation-id', correlationId);

    const normalizedCacheFeature = cacheFeatureForFunction(functionName);
    const needsEffectiveLimits =
      req.method === 'POST' &&
      [
        'document-upload',
        'chat',
        'au-chat',
        'global-chat',
        'generate-knowledge',
        'prediction-engine',
        'generate-exam-predictions',
        'exam-generator',
        'generate-practice-exam',
      ].includes(normalizedFunction);
    const effectiveLimits = needsEffectiveLimits
      ? await getEffectiveLimits(adminSupabase, auth.userId)
      : null;

    if (effectiveLimits && normalizedFunction === 'document-upload' && req.method === 'POST') {
      const action = String(parsedBody?.action || '').trim().toLowerCase();
      if (action === 'initiate') {
        const fileSizeBytes = Number(parsedBody?.fileSize ?? parsedBody?.file_size ?? 0);
        if (Number.isFinite(fileSizeBytes) && fileSizeBytes > 0) {
          throwUploadLimitIfNeeded({
            limits: effectiveLimits,
            fileSizeBytes,
            correlationId,
          });
        }
      }
      if (action === 'complete') {
        const fileSizeBytes = Number(parsedBody?.fileSize ?? parsedBody?.file_size ?? 0);
        if (Number.isFinite(fileSizeBytes) && fileSizeBytes > 0) {
          throwUploadLimitIfNeeded({
            limits: effectiveLimits,
            fileSizeBytes,
            correlationId,
          });
        }
        throwIngestLimitIfNeeded({
          limits: effectiveLimits,
          correlationId,
        });
      }
    }

    if (effectiveLimits && canonicalChatPayload) {
      if (!canonicalChatPayload.idempotencyKey) {
        return NextResponse.json(
          {
            status: 400,
            code: 'IDEMPOTENCY_KEY_REQUIRED',
            message: 'idempotencyKey is required for chat requests.',
            limit: 'idempotencyKey',
            current: 0,
            action: 'chat',
            correlation_id: correlationId,
          },
          { status: 400, headers: { ...corsHeaders(requestId), 'Cache-Control': 'no-store' } },
        );
      }

      throwChatLimitIfNeeded({
        limits: effectiveLimits,
        correlationId,
      });

      chatNormalizedQuestion = normalizeQuestion(latestUserMessage(canonicalChatPayload));
      chatActiveDocScope = buildDocScope(canonicalChatPayload.activeDocIds);
      chatSettingsHash = buildSettingsHash(canonicalChatPayload.auGuide || {});
      chatRequestHash = sha256Hex(JSON.stringify({
        feature: chatRuntimeFeature,
        messages: canonicalChatPayload.messages,
        activeDocIds: canonicalChatPayload.activeDocIds || [],
        sessionId: canonicalChatPayload.sessionId || null,
        auGuide: canonicalChatPayload.auGuide || {},
      }));
      chatIdempotencyStorageKey = buildIdempotencyStorageKey(
        auth.userId,
        chatRuntimeFeature,
        canonicalChatPayload.idempotencyKey,
      );

      const idempotent = await readIdempotencyRecord({
        supabase: adminSupabase,
        key: chatIdempotencyStorageKey,
      });
      if (idempotent?.response) {
        await recordSyntheticUsage({
          supabase: adminSupabase,
          userId: auth.userId,
          feature: chatRuntimeFeature,
          model: 'idempotency_cache',
          requestId,
          correlationId,
          cacheHit: true,
          metadata: { source: 'idempotency' },
        });
        return NextResponse.json(idempotent.response, {
          status: idempotent.statusCode || 200,
          headers: { ...corsHeaders(requestId), 'Cache-Control': 'no-store' },
        });
      }

      const templateResponse = classifyTemplateResponse(
        latestUserMessage(canonicalChatPayload),
        normalizedFunction === 'global-chat' ? 'global' : 'doc',
      );
      if (templateResponse) {
        const payload = {
          answer: templateResponse.answer,
          thought: null,
          citations: [],
          nav_action: templateResponse.navAction ?? null,
          correlation_id: correlationId,
          cache_hit: true,
          source: 'template',
        };
        await writeIdempotencyRecord({
          supabase: adminSupabase,
          key: chatIdempotencyStorageKey,
          userId: auth.userId,
          feature: chatRuntimeFeature,
          requestHash: chatRequestHash,
          response: payload,
          statusCode: 200,
          correlationId,
        });
        await recordSyntheticUsage({
          supabase: adminSupabase,
          userId: auth.userId,
          feature: chatRuntimeFeature,
          model: 'template_router',
          requestId,
          correlationId,
          cacheHit: true,
          metadata: { source: 'template_router' },
        });
        return NextResponse.json(payload, {
          status: 200,
          headers: { ...corsHeaders(requestId), 'Cache-Control': 'no-store' },
        });
      }

      if (chatNormalizedQuestion) {
        chatAnswerCacheKey = buildAnswerCacheKey({
          userId: auth.userId,
          feature: chatRuntimeFeature,
          question: chatNormalizedQuestion,
          activeDocScope: chatActiveDocScope,
          settingsHash: chatSettingsHash,
        });
        const cachedAnswer = await readAnswerCache({
          supabase: adminSupabase,
          cacheKey: chatAnswerCacheKey,
        });
        if (cachedAnswer?.response) {
          await touchAnswerCacheHit({ supabase: adminSupabase, cacheKey: chatAnswerCacheKey });
          await writeIdempotencyRecord({
            supabase: adminSupabase,
            key: chatIdempotencyStorageKey,
            userId: auth.userId,
            feature: chatRuntimeFeature,
            requestHash: chatRequestHash,
            response: cachedAnswer.response,
            statusCode: 200,
            correlationId,
          });
          await recordSyntheticUsage({
            supabase: adminSupabase,
            userId: auth.userId,
            feature: chatRuntimeFeature,
            model: cachedAnswer.model || 'answer_cache',
            requestId,
            correlationId,
            cacheHit: true,
            savedTokens: cachedAnswer.tokens,
            metadata: { source: 'answer_cache' },
          });
          return NextResponse.json(cachedAnswer.response, {
            status: 200,
            headers: { ...corsHeaders(requestId), 'Cache-Control': 'no-store' },
          });
        }
      }
    }

    if (effectiveLimits && normalizedCacheFeature && normalizedCacheFeature !== 'chat') {
      let gateFeature: 'knowledge_hub' | 'exam_prediction' | 'practice_exam_generation' | null = null;
      if (normalizedFunction === 'generate-knowledge') gateFeature = 'knowledge_hub';
      if (normalizedFunction === 'prediction-engine' || normalizedFunction === 'generate-exam-predictions') {
        gateFeature = 'exam_prediction';
      }
      if (normalizedFunction === 'exam-generator' || normalizedFunction === 'generate-practice-exam') {
        gateFeature = 'practice_exam_generation';
      }

      if (gateFeature) {
        const gate = await getFeatureGateDecision(adminSupabase, gateFeature);
        if (!gate.enabled) {
          return NextResponse.json(
            buildPlanGatePayload({
              status: 403,
              code: 'FEATURE_DISABLED',
              key: gateFeature,
              message: 'This feature is currently disabled.',
              correlationId,
            }),
            { status: 403, headers: { ...corsHeaders(requestId), 'Cache-Control': 'no-store' } },
          );
        }

        const isPaidPlan = effectiveLimits.effectivePlan.plan === 'pro' || effectiveLimits.effectivePlan.isAdmin;
        if (gate.proRequired && !isPaidPlan) {
          return NextResponse.json(
            buildPlanGatePayload({
              status: 403,
              code: 'PRO_REQUIRED',
              key: gateFeature,
              message: 'This feature requires Pro.',
              correlationId,
            }),
            { status: 403, headers: { ...corsHeaders(requestId), 'Cache-Control': 'no-store' } },
          );
        }

        if (gateFeature === 'practice_exam_generation') {
          throwExamLimitIfNeeded({
            limits: effectiveLimits,
            correlationId,
            action: gateFeature,
          });
        }

        const documentId = extractDocumentIdForFeature(normalizedFunction, parsedBody);
        if (documentId) {
          const resolvedVersion = await resolveDocumentVersion({
            supabase: adminSupabase,
            userId: auth.userId,
            documentId,
            sourceText: String(buildFeatureSourceTexts(normalizedFunction, parsedBody)[0] || ''),
            fallbackTexts: buildFeatureSourceTexts(normalizedFunction, parsedBody),
          });
          featureOutputContext = {
            feature: gateFeature,
            documentId,
            docVersionId: resolvedVersion.versionId,
          };
          if (resolvedVersion.versionId) {
            const featureOutputState = await prepareFeatureOutputGeneration({
              supabase: adminSupabase,
              userId: auth.userId,
              docVersionId: resolvedVersion.versionId,
              feature: gateFeature,
            });
            if (featureOutputState.state === 'ready') {
              const cachedOutput = featureOutputState.record;
              await recordSyntheticUsage({
                supabase: adminSupabase,
                userId: auth.userId,
                feature: gateFeature,
                model: cachedOutput.model || 'feature_output_cache',
                requestId,
                correlationId,
                cacheHit: true,
                savedTokens: cachedOutput.tokens,
                metadata: { source: 'feature_output_cache' },
              });
              return NextResponse.json({
                ...(cachedOutput.output || {}),
                feature: gateFeature,
                doc_version_id: resolvedVersion.versionId,
                fromCache: true,
                generatedAt: cachedOutput.updatedAt || cachedOutput.createdAt,
                message: 'Already generated; cached result reused.',
              }, {
                status: 200,
                headers: { ...corsHeaders(requestId), 'Cache-Control': 'no-store' },
              });
            }
            if (featureOutputState.state === 'running') {
              return NextResponse.json(
                {
                  status: 409,
                  code: 'ALREADY_GENERATING',
                  message: 'This feature is already generating for the selected document.',
                  limit: gateFeature,
                  current: 1,
                  action: gateFeature,
                  correlation_id: correlationId,
                  feature: gateFeature,
                  doc_version_id: resolvedVersion.versionId,
                },
                { status: 409, headers: { ...corsHeaders(requestId), 'Cache-Control': 'no-store' } },
              );
            }
            if (featureOutputState.state === 'failed') {
              return NextResponse.json(
                {
                  status: 409,
                  code: 'FEATURE_OUTPUT_FAILED',
                  message: 'Generation previously failed for this document. Ask an admin to clear the cached output before retrying.',
                  limit: gateFeature,
                  current: 1,
                  action: gateFeature,
                  correlation_id: correlationId,
                  feature: gateFeature,
                  doc_version_id: resolvedVersion.versionId,
                  details: featureOutputState.record.output,
                },
                { status: 409, headers: { ...corsHeaders(requestId), 'Cache-Control': 'no-store' } },
              );
            }
            featureOutputReservation = {
              feature: gateFeature,
              docVersionId: resolvedVersion.versionId,
            };
          }
        }
      }
    }

    const isGetModelsAction =
      routeWithModelSelector &&
      String(parsedBody?.action || '').toLowerCase() === 'get_models';

    const needsTierGuards = isTierGuardedFunction(functionName);
    const supabase = needsTierGuards ? adminSupabase : null;
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

    if (isGetModelsAction) {
      const modelSupabase = supabase || createSupabaseAdminClient();
      try {
        const [models, defaultModel] = await Promise.all([
          getAllowedPaidModelsForProvider(modelSupabase, 'openrouter'),
          getDefaultPaidModel(modelSupabase, 'openrouter'),
        ]);
        return NextResponse.json(
          {
            models,
            default_model: defaultModel,
            provider: 'openrouter',
            source: 'au_api_keys',
          },
          { status: 200, headers: corsHeaders(requestId) }
        );
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
    }

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
      if (featureOutputReservation?.docVersionId) {
        await markFeatureOutputFailed({
          supabase: adminSupabase,
          userId: auth.userId,
          docVersionId: featureOutputReservation.docVersionId,
          feature: featureOutputReservation.feature,
          error: {
            message,
            code: response.status,
            details,
          },
        }).catch(() => {});
        featureOutputReservation = null;
      }
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
        const requestedModel =
          guardedBody && typeof guardedBody === 'object' && !Array.isArray(guardedBody)
            ? String((guardedBody as any).model || '').trim() || null
            : null;
        routed = await buildRoutingCandidates({
          supabase,
          userId: auth.userId,
          plan,
          requestType: requestType!,
          requestedModel,
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
      const routedCandidates =
        requestType === 'chat' || requestType === 'global_chat'
          ? routed.candidates.slice(0, 1)
          : routed.candidates;
      const maxLocalAttempts = requestType === 'chat' || requestType === 'global_chat' ? 1 : 2;

      for (const candidate of routedCandidates) {
        try {
          enforceModelAccess({
            tierContext,
            model: candidate.model,
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

        for (let localAttempt = 0; localAttempt < maxLocalAttempts; localAttempt += 1) {
          const response = await forwardOnce(attemptHeaders, attemptBody);
          const contentTypeResponse = String(response.headers.get('content-type') || '').toLowerCase();
          const isEventStream = contentTypeResponse.includes('text/event-stream');
          if (response.ok || (isEventStream && response.status < 400)) {
            try {
              await noteRoutingSuccess(supabase, candidate);
            } catch {
            }
            const parsedSuccessPayload = !isEventStream ? await parseJsonClone(response) : null;
            if (parsedSuccessPayload && response.ok) {
              if (canonicalChatPayload && chatIdempotencyStorageKey) {
                await writeIdempotencyRecord({
                  supabase: adminSupabase,
                  key: chatIdempotencyStorageKey,
                  userId: auth.userId,
                  feature: chatRuntimeFeature,
                  requestHash: chatRequestHash,
                  response: parsedSuccessPayload,
                  statusCode: response.status,
                  correlationId,
                });
                if (chatAnswerCacheKey && chatNormalizedQuestion) {
                  await writeAnswerCache({
                    supabase: adminSupabase,
                    cacheKey: chatAnswerCacheKey,
                    userId: auth.userId,
                    feature: chatRuntimeFeature,
                    normalizedQuestion: chatNormalizedQuestion,
                    activeDocScope: chatActiveDocScope,
                    settingsHash: chatSettingsHash,
                    response: parsedSuccessPayload,
                    model: candidate.model,
                    ttlDays: 7,
                  });
                }
              }

              if (featureOutputContext?.docVersionId) {
                await markFeatureOutputReady({
                  supabase: adminSupabase,
                  userId: auth.userId,
                  docVersionId: featureOutputContext.docVersionId,
                  feature: featureOutputContext.feature,
                  output: parsedSuccessPayload,
                  model: candidate.model,
                });
                featureOutputReservation = null;
              }
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

          const retryable = maxLocalAttempts > 1 && (status === 429 || status >= 500 || status === 408);
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
    if (reservationSupabase && reservationUserId && featureOutputReservation?.docVersionId) {
      await markFeatureOutputFailed({
        supabase: reservationSupabase,
        userId: reservationUserId,
        docVersionId: featureOutputReservation.docVersionId,
        feature: featureOutputReservation.feature,
        error,
      }).catch(() => {});
      featureOutputReservation = null;
    }
    if (error instanceof EffectiveLimitError) {
      return NextResponse.json(error.payload, {
        status: error.status,
        headers: {
          ...corsHeaders(requestId),
          'Cache-Control': 'no-store',
          ...(error.headers || {}),
        },
      });
    }

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
