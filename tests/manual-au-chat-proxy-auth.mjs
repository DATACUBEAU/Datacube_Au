#!/usr/bin/env node

const baseUrl = (process.env.BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const authToken = (process.env.AUTH_BEARER_TOKEN || '').trim();
const authCookie = (process.env.AUTH_COOKIE || '').trim();

async function readBody(response) {
  const raw = await response.text().catch(() => '');
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

async function callProxy(extraHeaders = {}) {
  return fetch(`${baseUrl}/api/proxy/au-chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: JSON.stringify({ action: 'get_models' }),
  });
}

async function main() {
  console.log(`[au-chat-proxy] Base URL: ${baseUrl}`);

  const unauth = await callProxy();
  const unauthBody = await readBody(unauth);
  console.log('[au-chat-proxy] unauthenticated status:', unauth.status);
  console.log('[au-chat-proxy] unauthenticated body:', unauthBody);

  if (unauth.status !== 401) {
    throw new Error(`Expected 401 when logged out, got ${unauth.status}`);
  }

  if (!authToken && !authCookie) {
    console.log('[au-chat-proxy] AUTH_BEARER_TOKEN/AUTH_COOKIE not provided; skipping authenticated check.');
    return;
  }

  const headers = {};
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  if (authCookie) headers.Cookie = authCookie;

  const authed = await callProxy(headers);
  const authedBody = await readBody(authed);
  console.log('[au-chat-proxy] authenticated status:', authed.status);
  console.log('[au-chat-proxy] authenticated body:', authedBody);

  if (authed.status === 401) {
    throw new Error('Expected authenticated request to be non-401, got 401.');
  }
}

main().catch((error) => {
  console.error('[au-chat-proxy] failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
