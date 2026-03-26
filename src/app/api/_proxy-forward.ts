import { NextResponse } from 'next/server';
import { buildApiErrorBody } from '@/lib/api/api-contract';

type ForwardProxyJsonRequestOptions = {
  targetPath: string;
  routeLabel: string;
  method?: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  allowEmptyBody?: boolean;
};

function buildForwardHeaders(req: Request, hasBody: boolean): Headers {
  const headers = new Headers();
  const accept = req.headers.get('accept');
  const authorization = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  const correlationId = req.headers.get('x-correlation-id');
  const requestId = req.headers.get('x-request-id');

  if (hasBody) {
    headers.set('Content-Type', 'application/json');
  }
  if (accept) {
    headers.set('Accept', accept);
  }
  if (authorization) {
    headers.set('Authorization', authorization);
  }
  if (cookie) {
    headers.set('Cookie', cookie);
  }
  if (correlationId) {
    headers.set('x-correlation-id', correlationId);
  }
  if (requestId) {
    headers.set('x-request-id', requestId);
  }

  return headers;
}

function buildForwardResponseHeaders(res: Response): Headers {
  const headers = new Headers();
  const cacheControl = res.headers.get('cache-control');
  const retryAfter = res.headers.get('retry-after');

  headers.set('Cache-Control', cacheControl || 'no-store');
  if (retryAfter) {
    headers.set('Retry-After', retryAfter);
  }

  return headers;
}

async function relayProxyJsonResponse(res: Response): Promise<NextResponse> {
  const text = await res.text();
  let payload: unknown = null;

  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = buildApiErrorBody({
      status: res.status,
      code: res.ok ? 'INVALID_PROXY_RESPONSE' : undefined,
      message: text || res.statusText || 'Proxy request failed.',
      details: text || null,
      retryable: res.status >= 500,
    });
  }

  return NextResponse.json(payload, {
    status: res.status,
    headers: buildForwardResponseHeaders(res),
  });
}

export async function forwardProxyJsonRequest(
  req: Request,
  options: ForwardProxyJsonRequestOptions,
): Promise<NextResponse> {
  const rawBody = await req.text();
  const trimmedBody = rawBody.trim();

  if (!options.allowEmptyBody && !trimmedBody) {
    return NextResponse.json(
      buildApiErrorBody({
        status: 400,
        code: 'INVALID_REQUEST_PAYLOAD',
        message: 'Invalid request payload.',
        retryable: false,
      }),
      {
        status: 400,
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  }

  if (trimmedBody) {
    try {
      JSON.parse(trimmedBody);
    } catch {
      return NextResponse.json(
        buildApiErrorBody({
          status: 400,
          code: 'INVALID_REQUEST_PAYLOAD',
          message: 'Invalid request payload.',
          details: { reason: 'malformed_json' },
          retryable: false,
        }),
        {
          status: 400,
          headers: { 'Cache-Control': 'no-store' },
        },
      );
    }
  }

  const res = await fetch(new URL(options.targetPath, req.url).toString(), {
    method: options.method ?? req.method,
    headers: buildForwardHeaders(req, trimmedBody.length > 0),
    body: trimmedBody ? rawBody : undefined,
  });

  return relayProxyJsonResponse(res);
}

export function buildUnexpectedProxyError(routeLabel: string, error: unknown): NextResponse {
  console.error(`[API ${routeLabel}] Error:`, error);
  return NextResponse.json(
    buildApiErrorBody({
      status: 500,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Unexpected server error.',
      details: String((error as any)?.message || error || 'unknown_error'),
    }),
    {
      status: 500,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
