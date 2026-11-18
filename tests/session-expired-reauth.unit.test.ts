import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  buildLoginReauthPath,
  buildSessionExpiredPath,
  isPublicAuthPath,
  sanitizeLocalRedirectPath,
} from '../src/lib/auth/redirects.js';

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
  await run('safe local return path is preserved and malicious targets are rejected', () => {
    assert.equal(sanitizeLocalRedirectPath('/dashboard/chat?doc=abc'), '/checkout');
    assert.equal(sanitizeLocalRedirectPath('//evil.example/dashboard'), '/checkout');
    assert.equal(sanitizeLocalRedirectPath('https://evil.example/dashboard'), '/checkout');
    assert.equal(sanitizeLocalRedirectPath('/login?redirectTo=/dashboard'), '/checkout');
    assert.equal(sanitizeLocalRedirectPath('/session-expired?next=/dashboard'), '/checkout');
  });

  await run('expired-session and login URLs carry only safe local paths', () => {
    assert.equal(
      buildSessionExpiredPath('/dashboard/knowledge'),
      '/session-expired?next=%2Fcheckout',
    );
    assert.equal(
      buildLoginReauthPath('/dashboard/knowledge'),
      '/login?redirectTo=%2Fcheckout&reason=session_expired',
    );
  });

  await run('public auth routes remain public while unauthenticated', () => {
    assert.equal(isPublicAuthPath('/login'), true);
    assert.equal(isPublicAuthPath('/signup'), true);
    assert.equal(isPublicAuthPath('/auth/callback'), true);
    assert.equal(isPublicAuthPath('/session-expired'), true);
    assert.equal(isPublicAuthPath('/dashboard'), false);
  });

  await run('auth lock redirects to session-expired once and does not inert the app shell', () => {
    const overlay = readRepoFile('src', 'components', 'auth-lock-overlay.tsx');
    assert.match(overlay, /buildSessionExpiredPath/);
    assert.match(overlay, /claimReauthRedirect/);
    assert.match(overlay, /isPublicAuthPath/);
    assert.doesNotMatch(overlay, /window\.location\.reload/);
    assert.doesNotMatch(overlay, /router\.refresh/);
    assert.doesNotMatch(overlay, /\.inert\s*=/);
    assert.doesNotMatch(overlay, /document\.body\.style\.overflow/);
  });

  await run('expired-session route returns to login with a safe checkout target', () => {
    const middleware = readRepoFile('src', 'middleware.ts');
    const login = readRepoFile('src', 'app', 'login', 'page.tsx');
    assert.match(middleware, /pathname === '\/session-expired'/);
    assert.match(middleware, /sanitizeLocalRedirectPath\(req\.nextUrl\.searchParams\.get\('next'\)\)/);
    assert.match(middleware, /searchParams\.set\('reason', 'session_expired'\)/);
    assert.match(login, /wasSessionExpired/);
    assert.match(login, /Your session expired\. Please sign in again to continue\./);
    assert.doesNotMatch(middleware, /'\/session-expired',/);
  });;

  if (failed > 0) {
    process.exit(1);
  }
}

void main();
