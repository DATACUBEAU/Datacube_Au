import assert from 'node:assert/strict';
import {
  clearServerAuthSessionCookie,
  hasServerAuthSessionCookie,
  syncServerAuthSessionCookie,
} from '../src/lib/auth/session-cookie.js';

type CookieRecord = {
  value: string;
  maxAge: number | null;
};

let failed = 0;
const cookieJar = new Map<string, CookieRecord>();

function setupBrowserGlobals() {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: {
        protocol: 'https:',
      },
    },
  });

  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      get cookie() {
        return Array.from(cookieJar.entries())
          .map(([name, record]) => `${name}=${record.value}`)
          .join('; ');
      },
      set cookie(raw: string) {
        const parts = raw.split(';').map((part) => part.trim()).filter(Boolean);
        if (parts.length === 0) return;
        const [nameValue, ...attributes] = parts;
        const eqIndex = nameValue.indexOf('=');
        if (eqIndex <= 0) return;
        const name = nameValue.slice(0, eqIndex);
        const value = nameValue.slice(eqIndex + 1);

        let maxAge: number | null = null;
        for (const attr of attributes) {
          const lower = attr.toLowerCase();
          if (!lower.startsWith('max-age=')) continue;
          const parsed = Number(attr.slice('max-age='.length));
          maxAge = Number.isFinite(parsed) ? parsed : null;
        }

        if (maxAge !== null && maxAge <= 0) {
          cookieJar.delete(name);
          return;
        }

        cookieJar.set(name, { value, maxAge });
      },
    },
  });
}

function resetCookieJar() {
  cookieJar.clear();
}

function run(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error: any) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error?.stack || error);
  }
}

setupBrowserGlobals();

run('syncServerAuthSessionCookie writes a server-readable auth cookie for active session', () => {
  resetCookieJar();
  const futureExpires = Math.floor(Date.now() / 1000) + 120;
  syncServerAuthSessionCookie({
    access_token: 'header.payload.signature',
    expires_at: futureExpires,
  } as any);

  assert.equal(hasServerAuthSessionCookie(), true);
  const record = cookieJar.get('sb-access-token');
  assert.ok(record);
  assert.match(String(record?.value), /^header\.payload\.signature/);
  assert.ok((record?.maxAge || 0) > 0);
});

run('syncServerAuthSessionCookie clears expired sessions instead of preserving stale cookie', () => {
  resetCookieJar();
  syncServerAuthSessionCookie({
    access_token: 'stale.token.value',
    expires_at: Math.floor(Date.now() / 1000) - 30,
  } as any);

  assert.equal(hasServerAuthSessionCookie(), false);
});

run('clearServerAuthSessionCookie removes cookie explicitly', () => {
  resetCookieJar();
  syncServerAuthSessionCookie({
    access_token: 'token.value.here',
    expires_at: Math.floor(Date.now() / 1000) + 90,
  } as any);
  assert.equal(hasServerAuthSessionCookie(), true);

  clearServerAuthSessionCookie();
  assert.equal(hasServerAuthSessionCookie(), false);
});

if (failed > 0) process.exit(1);
