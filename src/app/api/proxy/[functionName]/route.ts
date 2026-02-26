import { NextRequest, NextResponse } from 'next/server';
import { requireUserFromRequest } from '@/app/api/proxy/_supabase-auth';

export const runtime = 'edge';

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

    let body: BodyInit | undefined;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const rawBody = await req.arrayBuffer();
      if (rawBody.byteLength > 0) {
        body = rawBody;
      }
    }

    const response = await fetch(targetUrl.toString(), {
      method: req.method,
      headers,
      body,
    });

    const contentTypeResponse = String(response.headers.get('content-type') || '').toLowerCase();
    const isEventStream = contentTypeResponse.includes('text/event-stream');

    if (!response.ok && !isEventStream) {
      const { details, raw } = await parseErrorPayload(response);
      const message = messageFromFailure(response.status, details, response.statusText);
      console.error('[proxy] edge function failed', {
        requestId,
        functionName,
        userId: auth.userId,
        status: response.status,
        message,
        errorBody: truncateForLog(raw || details),
      });

      return NextResponse.json(
        {
          message,
          error: message,
          status: response.status,
          requestId,
          details,
        },
        { status: response.status, headers: corsHeaders(requestId) },
      );
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
