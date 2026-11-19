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
  await run('Workbox generated clientsClaim injection is disabled', () => {
    const nextConfig = readRepoFile('next.config.ts');
    assert.match(nextConfig, /skipWaiting: false/);
    assert.match(nextConfig, /clientsClaim: false/);
    assert.equal((nextConfig.match(/'\/checkout',/g) || []).length >= 4, true);
    assert.match(nextConfig, /'\/_next\/static\/chunks\/app\/checkout\//);
  });

  await run('active Workbox worker only skips waiting and never claims clients', () => {
    const worker = readRepoFile('public', 'sw.js');
    const messageStart = worker.indexOf('self.addEventListener("message"');
    assert.ok(messageStart >= 0, 'active service worker must expose its message handler');
    const messageEnd = worker.indexOf('),e.precacheAndRoute', messageStart);
    const messageBlock = worker.slice(messageStart, messageEnd > messageStart ? messageEnd : messageStart + 500);
    assert.match(messageBlock, /self\.skipWaiting\(\)/);
    assert.doesNotMatch(messageBlock, /clients\.claim\(/);
    assert.doesNotMatch(worker, /clients\.claim\(/);
  });

  await run('protected/private responses remain excluded from runtime caching', () => {
    const nextConfig = readRepoFile('next.config.ts');
    assert.equal(
      nextConfig.includes('/\\/api\\/(account|admin|au|auth|billing|chat|entitlements|feedback|limits|payments)(\\/|$)/i'),
      true,
    );
    assert.equal(nextConfig.includes('/\\/api\\/feature-output$/i'), true);
    assert.equal(nextConfig.includes('/\\/api\\/feature-flags$/i'), true);
    assert.match(nextConfig, /handler: 'NetworkOnly'/);
    assert.match(nextConfig, /PWA_RUNTIME_CACHE_NAMES\['supabase-no-cache'\]/);
    assert.doesNotMatch(nextConfig, /PWA_RUNTIME_CACHE_NAMES\['supabase-swr'\]/);
  });

  if (failed > 0) {
    process.exit(1);
  }
}

void main();
