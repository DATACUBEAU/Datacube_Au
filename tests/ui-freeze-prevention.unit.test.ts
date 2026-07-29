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
  await run('auth restoration is single-flight and bounded', () => {
    const client = readRepoFile('src', 'lib', 'supabase-client', 'client.ts');
    assert.match(client, /resolveBrowserSessionPromise/);
    assert.match(client, /BROWSER_SESSION_RESOLVE_TIMEOUT_MS = 12000/);
    assert.match(client, /Promise\.race\(\[/);
    assert.match(client, /timeoutBrowserSessionResolution/);
  });

  await run('expired auth flow avoids reload and router refresh loops', () => {
    const overlay = readRepoFile('src', 'components', 'auth-lock-overlay.tsx');
    const safeFetch = readRepoFile('src', 'lib', 'api', 'safe-fetch.ts');
    const sessionEvents = readRepoFile('src', 'lib', 'auth', 'session-expiry-events.ts');
    assert.doesNotMatch(overlay, /window\.location\.reload/);
    assert.doesNotMatch(overlay, /router\.refresh/);
    assert.match(overlay, /router\.replace\(buildSessionExpiredPath/);
    assert.match(sessionEvents, /DISPATCH_COOLDOWN_MS = 15000/);
    assert.match(safeFetch, /timeout = 10000/);
  });

  await run('non-critical account and feature loaders always exit loading state on failure', () => {
    const account = readRepoFile('src', 'components', 'providers', 'account-snapshot-provider.tsx');
    const flags = readRepoFile('src', 'components', 'feature-flag-provider.tsx');
    assert.match(account, /setLoading\(fallback\.loading\)/);
    assert.match(account, /setLoading\(false\)/);
    assert.match(account, /inflightFetchRef/);
    assert.match(flags, /finally \{[\s\S]*setLoading\(false\);[\s\S]*inflightFetchRef\.current = null;/);
    assert.match(flags, /inflightFetchRef/);
  });

  await run('debug logs are gated and do not print session objects', () => {
    const smartAuth = readRepoFile('src', 'hooks', 'use-smart-auth.tsx');
    const events = readRepoFile('src', 'lib', 'auth', 'session-expiry-events.ts');
    const safeFetch = readRepoFile('src', 'lib', 'api', 'safe-fetch.ts');
    assert.match(smartAuth, /isAuthDebugEnabled/);
    assert.match(events, /isAuthDebugEnabled/);
    assert.match(safeFetch, /isSafeFetchDebugEnabled/);
    assert.doesNotMatch(smartAuth, /console\.log/);
    assert.doesNotMatch(smartAuth, /session:\s*resolved\.session/);
  });

  await run('document delete no longer forces a full page reload', () => {
    const docsPage = readRepoFile('src', 'app', 'dashboard', 'documents', 'page.tsx');
    assert.doesNotMatch(docsPage, /window\.location\.reload/);
    assert.match(docsPage, /await refresh\(\)/);
  });

  if (failed > 0) {
    process.exit(1);
  }
}

void main();
