import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  buildLoginReauthPath,
  buildSessionExpiredPath,
  isMobileAuthorizationDestination,
  isPublicAuthPath,
  isPublicDistributionPath,
  sanitizeLocalRedirectPath,
  sanitizeRedirectTarget,
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
    assert.equal(sanitizeLocalRedirectPath('/dashboard/chat?doc=abc'), '/dashboard/chat?doc=abc');
    assert.equal(sanitizeLocalRedirectPath('//evil.example/dashboard'), '/mobile-app-required');
    assert.equal(sanitizeLocalRedirectPath('https://evil.example/dashboard'), '/mobile-app-required');
    assert.equal(sanitizeLocalRedirectPath('/login?redirectTo=/dashboard'), '/mobile-app-required');
    assert.equal(sanitizeLocalRedirectPath('/session-expired?next=/dashboard'), '/mobile-app-required');
  });

  await run('expired-session and login URLs carry only safe local paths', () => {
    assert.equal(
      buildSessionExpiredPath('/dashboard/knowledge'),
      '/session-expired?next=%2Fdashboard%2Fknowledge',
    );
    assert.equal(
      buildLoginReauthPath('/dashboard/knowledge'),
      '/login?redirectTo=%2Fdashboard%2Fknowledge&reason=session_expired',
    );
  });

  await run('mobile OAuth redirect requires exactly one opaque request ID', () => {
    const requestId = 'a'.repeat(43);
    const approval = `/mobile-auth/approve?request=${requestId}`;
    const returnPath = `/mobile-auth/return?request=${requestId}`;
    assert.equal(sanitizeLocalRedirectPath(approval, '/'), approval);
    assert.equal(sanitizeLocalRedirectPath(returnPath, '/'), returnPath);
    assert.equal(sanitizeLocalRedirectPath(`/mobile-auth/approve/?request=${requestId}`, '/'), approval);
    assert.equal(sanitizeRedirectTarget(`https://datacube.example${approval}`, 'https://datacube.example'), approval);
    assert.equal(isMobileAuthorizationDestination(approval), true);
    assert.equal(isMobileAuthorizationDestination(returnPath), true);
    assert.equal(isMobileAuthorizationDestination('/mobile-auth/complete'), false);

    for (const invalid of [
      '/mobile-auth/approve',
      '/mobile-auth/approve?request=short',
      '/mobile-auth/return?request=short',
      `${approval}&request=${requestId}`,
      `${approval}&pairingCode=ABCD2345`,
      `${approval}#fragment`,
      `//evil.example${approval}`,
    ]) assert.equal(sanitizeLocalRedirectPath(invalid, '/'), '/', invalid);

    const legacy = '/mobile-auth/complete?state=state&code_challenge=challenge';
    assert.equal(sanitizeLocalRedirectPath(legacy, '/'), legacy);
    assert.equal(isPublicAuthPath('/mobile-auth/approve'), true);
    assert.equal(isPublicAuthPath('/mobile-auth/return'), true);
  });

  await run('public auth routes remain public while unauthenticated', () => {
    assert.equal(isPublicAuthPath('/login'), true);
    assert.equal(isPublicAuthPath('/signup'), true);
    assert.equal(isPublicAuthPath('/auth/callback'), true);
    assert.equal(isPublicAuthPath('/session-expired'), true);
    assert.equal(isPublicAuthPath('/dashboard'), false);
  });

  await run('public distribution is independent of protected-session redirects', () => {
    for (const path of ['/', '/download', '/features', '/about', '/pricing', '/policy', '/mobile-app-required', '/mobile-auth/install']) {
      assert.equal(isPublicDistributionPath(path), true);
    }
    assert.equal(isPublicDistributionPath('/dashboard/settings'), false);
    assert.equal(isPublicDistributionPath('/conex'), false);
    assert.equal(isPublicDistributionPath('/api/android-update'), false);
    assert.match(readRepoFile('src', 'components', 'auth-lock-overlay.tsx'), /!isPublicDistributionPath\(pathname\)/);
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

  await run('expired-session page has required message and reauthenticate action', () => {
    const page = readRepoFile('src', 'app', 'session-expired', 'page.tsx');
    assert.match(page, /Your session has expired/);
    assert.match(page, /For your security, please sign in again to renew your session\./);
    assert.match(page, /Re-authenticate/);
    assert.match(page, /Return to home/);
    assert.match(page, /buildLoginReauthPath/);
  });

  if (failed > 0) {
    process.exit(1);
  }
}

void main();
