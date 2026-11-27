// Single-use OAuth transport only. Supabase remains the sole session issuer.
const BODY_LIMIT = 2048;
const RESPONSE_LIMIT = 131072;
const CODE = /^[A-Za-z0-9._~-]{1,256}$/;
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
const SAFE_UPSTREAM_CODES = new Set(['bad_code_verifier','flow_state_not_found','flow_state_expired','validation_failed','over_request_rate_limit','unexpected_failure','request_timeout','invalid_grant']);

async function readBounded(stream: ReadableStream<Uint8Array> | null, limit: number): Promise<string | null> {
  if (!stream) return null;
  const reader = stream.getReader();
  const bytes = new Uint8Array(limit);
  let offset = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (offset + value.byteLength > limit) {
        void reader.cancel().catch(() => undefined);
        return null;
      }
      bytes.set(value, offset);
      offset += value.byteLength;
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, offset));
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

export type PkceTransportDependencies = {
  origin: string;
  requestId: string;
  allow: () => boolean;
  config: () => { url: string; anonKey: string };
  upstreamFetch: typeof fetch;
  record: (stage: string, status: number, elapsedMs: number) => void;
};

export async function exchangePkceTransport(request: Request, deps: PkceTransportDependencies): Promise<Response> {
  const started = Date.now();
  const response = (stage: string, status: number, body: string, retryAfter?: string) => {
    deps.record(stage, status, Date.now() - started);
    return new Response(body, {
      status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store, private, max-age=0',
        Pragma: 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'X-Supabase-API-Version': '2024-01-01',
        'X-DCAU-PKCE-Stage': stage,
        'X-Request-Id': deps.requestId,
        ...(retryAfter && /^\d{1,6}$/.test(retryAfter) ? { 'Retry-After': retryAfter } : {}),
      },
    });
  };
  const problem = (stage: string, status: number, code: string, retryAfter?: string) =>
    response(stage, status, JSON.stringify({ code, message: 'Authentication exchange could not be completed.' }), retryAfter);
  if (request.method !== 'POST' || request.headers.get('origin') !== deps.origin
    || request.headers.get('sec-fetch-site') === 'cross-site') {
    return problem('origin_rejected', 403, 'invalid_origin');
  }
  const query = new URL(request.url).searchParams;
  if (query.toString() !== 'grant_type=pkce'
    || request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json'
    || Number(request.headers.get('content-length') || 0) > BODY_LIMIT) {
    return problem('invalid_request', 400, 'validation_failed');
  }
  const raw = await readBounded(request.body, BODY_LIMIT);
  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw ?? '');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).length !== 2) throw new Error();
    body = parsed;
  } catch {
    return problem('invalid_request', 400, 'validation_failed');
  }
  if (typeof body.auth_code !== 'string' || !CODE.test(body.auth_code)
    || typeof body.code_verifier !== 'string' || !VERIFIER.test(body.code_verifier)) {
    return problem('invalid_request', 400, 'validation_failed');
  }
  if (!deps.allow()) return problem('rate_limited', 429, 'over_request_rate_limit', '60');
  try {
    const { url, anonKey } = deps.config();
    const target = new URL('/auth/v1/token?grant_type=pkce', url);
    // Never accept a destination, key, cookie, bearer token or grant from the caller.
    // The project and public API key come from the existing server configuration.
    if (target.username || target.password || (target.protocol !== 'https:' && target.hostname !== 'localhost' && target.hostname !== '127.0.0.1')) {
      return problem('configuration_error', 503, 'unexpected_failure');
    }
    const upstream = await deps.upstreamFetch(target, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        'X-Supabase-API-Version': '2024-01-01',
      },
      body: JSON.stringify({ auth_code: body.auth_code, code_verifier: body.code_verifier }),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    const payload = await readBounded(upstream.body, RESPONSE_LIMIT);
    if (payload === null) return problem('upstream_response_interrupted', 502, 'unexpected_failure');
    if (!upstream.ok) {
      let code = 'unexpected_failure';
      try {
        const parsed = JSON.parse(payload);
        const candidate = parsed.code ?? parsed.error_code;
        if (SAFE_UPSTREAM_CODES.has(candidate)) code = candidate;
      } catch {}
      const status = upstream.status >= 400 && upstream.status <= 599 ? upstream.status : 502;
      return problem('upstream_rejected', status, code, upstream.headers.get('retry-after') ?? undefined);
    }
    // The SDK processes and persists the original Supabase session. No session
    // minting, new auth client, token rewriting or storage is performed here.
    if (upstream.status !== 200) return problem('upstream_response_invalid', 502, 'unexpected_failure');
    return response('upstream_ok', 200, payload);
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    return problem(name === 'TimeoutError' || name === 'AbortError' ? 'upstream_timeout' : 'upstream_unreachable', 503, 'unexpected_failure');
  }
}
