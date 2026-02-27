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

function buildHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  if (authCookie) headers.Cookie = authCookie;
  return headers;
}

async function call(path, payload) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify(payload),
  });
  const body = await readBody(response);
  return { response, body };
}

async function main() {
  console.log(`[ai-smoke] Base URL: ${baseUrl}`);
  if (!authToken && !authCookie) {
    console.log('[ai-smoke] AUTH_BEARER_TOKEN or AUTH_COOKIE is required for authenticated smoke tests.');
    process.exit(1);
  }

  const checks = [
    {
      name: 'au-chat:get_models',
      path: '/api/proxy/au-chat',
      payload: { action: 'get_models' },
    },
    {
      name: 'global-chat',
      path: '/api/proxy/global-chat',
      payload: {
        chat_type: 'global',
        user_input: 'Health check ping',
        thread_id: 'smoke-global',
      },
    },
    {
      name: 'generate-knowledge',
      path: '/api/proxy/generate-knowledge',
      payload: {
        documentContent: 'Smoke test study content.',
      },
    },
    {
      name: 'generate-prompt-starters',
      path: '/api/proxy/generate-prompt-starters',
      payload: {
        documentTitle: 'Smoke Doc',
        documentContent: 'Smoke test document content.',
      },
    },
  ];

  let failed = false;
  for (const check of checks) {
    const { response, body } = await call(check.path, check.payload);
    console.log(`[ai-smoke] ${check.name} -> status=${response.status}`);
    if (response.status === 404) {
      failed = true;
      console.error(`[ai-smoke] 404 detected for ${check.name}`, body);
    }
  }

  if (failed) {
    throw new Error('One or more AI endpoints returned 404.');
  }

  console.log('[ai-smoke] Completed: no 404 responses detected.');
}

main().catch((error) => {
  console.error('[ai-smoke] failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
