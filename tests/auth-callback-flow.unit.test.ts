import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

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
    assert.match(client, /detectSessionInUrl: true/);
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
    assert.match(callback, /sanitizeLocalRedirectPath\(searchParams\.get\('next'\)\)/);
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
    assert.match(smartAuth, /fresh_session_detected/);
    assert.match(smartAuth, /window\.location\.pathname\.startsWith\('\/auth\/callback'\)/);
  });

  await run('login and other OAuth entry points redirect through public callback', () => {
    const smartAuth = readRepoFile('src', 'hooks', 'use-smart-auth.tsx');
    const dashboard = readRepoFile('src', 'app', 'dashboard', 'dashboard-client-layout.tsx');
    const settings = readRepoFile('src', 'app', 'dashboard', 'settings', 'page.tsx');
    assert.match(smartAuth, /\/auth\/callback\?next=/);
    assert.match(dashboard, /\/auth\/callback\?next=/);
    assert.match(settings, /\/auth\/callback\?next=/);
  });

  await run('signed-out restore remains unauthenticated without breaking auth forms', () => {
    const stateTest = readRepoFile('tests', 'auth-state-hardening.unit.test.ts');
    const entryTest = readRepoFile('tests', 'auth-entry-flow.unit.test.ts');
    assert.match(stateTest, /UNAUTHENTICATED/);
    assert.match(entryTest, /no session or restoring auth does not remove login\/signup entry actions/);
  });

  if (failed > 0) {
    process.exit(1);
  }
}

void main();
