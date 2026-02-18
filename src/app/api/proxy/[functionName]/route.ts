
import { NextRequest, NextResponse } from 'next/server';
import { requireUserFromRequest } from '@/app/api/proxy/_supabase-auth';

export const runtime = 'edge';

function requiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing environment variable: ${key}`);
  return value;
}

function functionsBaseUrl(): string {
  return `${requiredEnv('NEXT_PUBLIC_SUPABASE_URL').replace(/\/$/, '')}/functions/v1`;
}

function corsHeaders(): HeadersInit {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, apikey, x-admin-token',
  };
}

async function proxyRequest(req: NextRequest, { params }: { params: Promise<{ functionName: string }> }) {
  const { functionName } = await params;
  const requestId = crypto.randomUUID();

  try {
    const url = new URL(req.url);
    const searchParams = url.searchParams;

    const targetUrl = new URL(`${functionsBaseUrl()}/${functionName}`);
    searchParams.forEach((value, key) => {
      targetUrl.searchParams.append(key, value);
    });

    const headers = new Headers();
    const auth = await requireUserFromRequest(req);
    if (!auth.ok) {
      return NextResponse.json(
        { error: 'unauthorized' },
        { status: 401, headers: corsHeaders() }
      );
    }
    headers.set('Authorization', `Bearer ${auth.accessToken}`);

    const contentType = req.headers.get('content-type');
    if (contentType) headers.set('Content-Type', contentType);

    const accept = req.headers.get('accept');
    if (accept) headers.set('Accept', accept);

    const adminToken = req.headers.get('x-admin-token');
    if (adminToken) headers.set('x-admin-token', adminToken);

    const passthroughHeaders = [
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

    const apikey = req.headers.get('apikey');
    if (apikey) {
      headers.set('apikey', apikey);
    } else {
      headers.set('apikey', requiredEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'));
    }

    let body: BodyInit | null = null;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      body = req.body;
    }

    const response = await fetch(targetUrl.toString(), {
      method: req.method,
      headers,
      body,
      // @ts-ignore - duplex is needed for streaming body in some environments but Next.js edge runtime handles it
      duplex: 'half',
    });

    if (!response.ok) {
      const ct = response.headers.get('content-type') || '';
      const isEventStream = ct.includes('text/event-stream');
      if (!isEventStream) {
        const raw = await response.text().catch(() => '');
        const lower = raw.toLowerCase();

        const isRegisteredOnly =
          lower.includes('registered user account required') ||
          lower.includes('registered account required') ||
          lower.includes('registered user required');
        const isUnauthorized = lower.includes('unauthorized') || lower.includes('invalid jwt') || lower.includes('jwt expired');
        const isForbidden = lower.includes('forbidden') || lower.includes('insufficient') || lower.includes('not allowed');

        if (response.status === 401 || (isUnauthorized && !isRegisteredOnly && !isForbidden)) {
          return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: corsHeaders() });
        }

        if (response.status === 403 || isRegisteredOnly || isForbidden) {
          return NextResponse.json({ error: 'forbidden' }, { status: 403, headers: corsHeaders() });
        }

        if (response.status >= 500 && (isRegisteredOnly || isForbidden)) {
          return NextResponse.json({ error: 'forbidden' }, { status: 403, headers: corsHeaders() });
        }

        if (response.status >= 500 && isUnauthorized) {
          return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: corsHeaders() });
        }

        const responseHeaders = new Headers(response.headers);
        Object.entries(corsHeaders()).forEach(([k, v]) => responseHeaders.set(k, String(v)));
        return new Response(raw, { status: response.status, statusText: response.statusText, headers: responseHeaders });
      }
    }

    const responseHeaders = new Headers(response.headers);
    Object.entries(corsHeaders()).forEach(([k, v]) => responseHeaders.set(k, String(v)));

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error: any) {
    console.error(`[Proxy] Error calling function ${functionName}:`, error);
    return NextResponse.json(
      { error: 'internal_server_error', requestId },
      { status: 500, headers: corsHeaders() }
    );
  }
}

export async function GET(req: NextRequest, props: { params: Promise<{ functionName: string }> }) {
  return proxyRequest(req, props);
}

export async function POST(req: NextRequest, props: { params: Promise<{ functionName: string }> }) {
  return proxyRequest(req, props);
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: corsHeaders(),
  });
}
