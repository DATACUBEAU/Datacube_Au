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
  });

  await run('custom worker claims clients only inside activate waitUntil and catches claim errors', () => {
    const worker = readRepoFile('worker', 'index.js');
    assert.match(worker, /async function claimActiveClients\(\)/);
    assert.match(worker, /await self\.clients\.claim\(\)/);
    assert.match(worker, /catch \{/);
    assert.match(worker, /self\.addEventListener\("activate", \(event\) => \{/);
    assert.match(worker, /event\.waitUntil\(\(async \(\) => \{/);
    const activateIndex = worker.indexOf('self.addEventListener("activate"');
    const claimCallIndex = worker.indexOf('await claimActiveClients()', activateIndex);
    assert.ok(claimCallIndex > activateIndex, 'activate handler must call claimActiveClients');
  });

  await run('SKIP_WAITING message never claims clients directly', () => {
    const worker = readRepoFile('worker', 'index.js');
    const messageIndex = worker.indexOf('self.addEventListener("message"');
    const messageBlock = worker.slice(messageIndex);
    assert.match(messageBlock, /self\.skipWaiting\(\)/);
    assert.doesNotMatch(messageBlock, /clients\.claim\(/);
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
