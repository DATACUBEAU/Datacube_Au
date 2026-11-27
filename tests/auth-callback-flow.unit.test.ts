import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { exchangePkceTransport } from '../src/lib/server/pkce-exchange.js';

let failed = 0;

function readRepoFile(...segments: string[]): string {
  return readFileSync(path.join(process.cwd(), ...segments), 'utf8');
}

async function run(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error: any) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error?.stack || error);
  }
}

async function main() {
  await run('browser Supabase client uses PKCE for code-based callback exchange', () => {
    const client = readRepoFile('src', 'lib', 'supabase-client', 'client.ts');
    assert.match(client, /flowType: 'pkce'/);
    assert.match(client, /detectSessionInUrl: false/);
  });

  await run('callback exchanges only when OAuth code exists', () => {
    const callback = readRepoFile('src', 'app', 'auth', 'callback', 'page.tsx');
    assert.match(callback, /const code = searchParams\.get\('code'\)/);
    assert.match(callback, /if \(!code\)/);
    assert.match(callback, /markAuthUnauthenticated\('auth-callback', 'missing_code'\)/);
    assert.match(callback, /exchangeCodeForSession\(code\)/);
    assert.doesNotMatch(callback, /await supabase\.auth\.getSession\(\)/);
  });

  await run('callback safely handles provider errors and local redirects', () => {
    const callback = readRepoFile('src', 'app', 'auth', 'callback', 'page.tsx');
    const redirects = readRepoFile('src', 'lib', 'auth', 'redirects.ts');
    assert.match(callback, /searchParams\.get\('error'\)/);
    assert.match(callback, /provider_error/);
    assert.match(callback, /sanitizeLocalRedirectPath\(searchParams\.get\('next'\), '\/'\)/);
    assert.match(redirects, /!candidate\.startsWith\('\/'\) \|\| candidate\.startsWith\('\/\/'\)/);
    assert.match(redirects, /AUTH_PUBLIC_PREFIXES/);
    assert.match(redirects, /isPublicAuthPath\(parsed\.pathname\)/);
    assert.match(callback, /safeLoginRedirect/);
  });

  await run('fresh callback session is synced and guarded from stale cleanup', () => {
    const callback = readRepoFile('src', 'app', 'auth', 'callback', 'page.tsx');
    const smartAuth = readRepoFile('src', 'hooks', 'use-smart-auth.tsx');
    assert.match(callback, /syncServerAuthSessionCookie\(session\)/);
    assert.match(callback, /markAuthSessionRestored\('auth-callback'\)/);
    assert.match(callback, /\/conex\/users\?mode=access/);
    assert.match(callback, /accessResponse = await fetch/);
    assert.match(callback, /router\.replace\('\/conex'\)/);
    assert.match(smartAuth, /fresh_session_detected/);
    assert.match(smartAuth, /window\.location\.pathname\.startsWith\('\/auth\/callback'\)/);
  });

  await run('login and other OAuth entry points redirect through public callback', () => {
    const smartAuth = readRepoFile('src', 'hooks', 'use-smart-auth.tsx');
    const dashboard = readRepoFile('src', 'app', 'dashboard', 'dashboard-client-layout.tsx');
    const settings = readRepoFile('src', 'app', 'dashboard', 'settings', 'page.tsx');
    assert.match(smartAuth, /\/auth\/callback\?next=/);
    assert.match(dashboard, /signInWithGoogle\('\/dashboard'\)/);
    assert.match(settings, /\/auth\/callback\?next=/);
  });

  await run('validated mobile transaction reaches approval before Conex access checks', () => {
    const callback = readRepoFile('src', 'app', 'auth', 'callback', 'page.tsx');
    const login = readRepoFile('src', 'app', 'login', 'page.tsx');
    for (const [source, path] of [[callback, 'nextPath'], [login, 'safeRedirectPath']]) {
      const mobileBranch = new RegExp(`if \\(isMobileDestination\\) \\{\\s+router\\.replace\\(${path}\\);`);
      const mobileCheck = source.search(mobileBranch);
      const conexCheck = source.indexOf("fetch('/conex/users?mode=access'");
      assert.notEqual(mobileCheck, -1);
      assert.notEqual(conexCheck, -1);
      assert.ok(mobileCheck < conexCheck);
    }
  });

  await run('signed-out restore remains unauthenticated while Google-only entry stays available', () => {
    const stateTest = readRepoFile('tests', 'auth-state-hardening.unit.test.ts');
    const login = readRepoFile('src', 'app', 'login', 'page.tsx');
    assert.match(stateTest, /UNAUTHENTICATED/);
    assert.match(login, /Continue with Google/);
    assert.doesNotMatch(login, /signInWithPassword|signUp\(/);
  });

  await run('same-origin transport forwards only one bounded PKCE exchange and preserves the SDK response', async () => {
    const origin = 'https://datacube.example';
    const endpoint = origin + '/api/auth/session?grant_type=pkce';
    const input = { auth_code: 'fixture-code', code_verifier: 'v'.repeat(43) };
    const session = { access_token: 'fixture-access', refresh_token: 'fixture-refresh', expires_in: 3600, user: { id: 'fixture-user' } };
    let calls = 0;
    const deps = {
      origin, requestId: 'fixture-id', allow: () => true,
      config: () => ({ url: 'https://project.example', anonKey: 'fixture-public-key' }),
      upstreamFetch: (async (url, init) => {
        calls++;
        assert.equal(String(url), 'https://project.example/auth/v1/token?grant_type=pkce');
        assert.equal(init?.redirect, 'error');
        assert.equal(init?.cache, 'no-store');
        assert.deepEqual(JSON.parse(String(init?.body)), input);
        assert.equal(new Headers(init?.headers).get('apikey'), 'fixture-public-key');
        assert.equal(new Headers(init?.headers).get('cookie'), null);
        return Response.json(session);
      }) as typeof fetch,
      record: () => {},
    };
    const make = (value: unknown, requestOrigin = origin, url = endpoint) => new Request(url, {
      method: 'POST', headers: { Origin: requestOrigin, 'Content-Type': 'application/json' }, body: JSON.stringify(value),
    });
    const success = await exchangePkceTransport(make(input), deps);
    assert.equal(success.status, 200);
    assert.equal(success.headers.get('x-dcau-pkce-stage'), 'upstream_ok');
    assert.match(success.headers.get('cache-control') ?? '', /no-store/);
    assert.deepEqual(await success.json(), session);
    assert.equal(calls, 1);
    assert.equal((await exchangePkceTransport(make(input, 'https://foreign.example'), deps)).status, 403);
    assert.equal((await exchangePkceTransport(make({ ...input, code_verifier: 'x' }), deps)).status, 400);
    assert.equal((await exchangePkceTransport(make({ ...input, auth_code: 'x'.repeat(3000) }), deps)).status, 400);
    assert.equal((await exchangePkceTransport(make(input, origin, origin + '/api/auth/session?grant_type=refresh_token'), deps)).status, 400);
    assert.equal((await exchangePkceTransport(make(input), { ...deps, allow: () => false })).status, 429);
    assert.equal(calls, 1);
    const rejected = await exchangePkceTransport(make(input), { ...deps, upstreamFetch: (async () =>
      Response.json({ code: 'flow_state_expired', message: 'private detail' }, { status: 400 })) as typeof fetch });
    assert.equal(rejected.status, 400);
    assert.equal((await rejected.json()).code, 'flow_state_expired');
    let failedCalls = 0;
    const unavailable = await exchangePkceTransport(make(input), { ...deps, upstreamFetch: (async () => {
      failedCalls++; throw new TypeError('network');
    }) as typeof fetch });
    assert.equal(unavailable.status, 503);
    assert.equal(unavailable.headers.get('x-dcau-pkce-stage'), 'upstream_unreachable');
    assert.equal(failedCalls, 1);
  });

  if (failed > 0) {
    process.exit(1);
  }
}

void main();
