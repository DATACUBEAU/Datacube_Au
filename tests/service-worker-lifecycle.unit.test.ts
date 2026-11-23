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

  await run('registration checks and recovers the existing worker before installing a fresh script', () => {
    const client = readRepoFile('src', 'lib', 'pwa', 'service-worker-client.ts');
    const registration = client.slice(client.indexOf('export async function ensureHealthyServiceWorkerRegistration'));
    assert.match(registration, /isBrokenServiceWorkerScript\(scriptText, importedScriptTexts\)\)\s*\{\s*await recoverBrokenServiceWorkerRuntime\(\);\s*return null;/);
    assert.match(registration, /!\(await hasHealthyExistingServiceWorker\(\)\)[\s\S]*?await recoverBrokenServiceWorkerRuntime\(\)[\s\S]*?navigator\.serviceWorker\.register\(scriptUrl/);
    assert.match(registration, /updateViaCache: 'none'/);
  });

  await run('registration and refresh ask only the waiting worker to activate', () => {
    const client = readRepoFile('src', 'lib', 'pwa', 'service-worker-client.ts');
    const registration = readRepoFile('src', 'components', 'service-worker-register.tsx');
    for (const source of [client, registration]) {
      assert.match(source, /if \(registration\.waiting\)\s*\{\s*registration\.waiting\.postMessage\(\{ type: ['"]SKIP_WAITING['"] \}\);/);
      assert.doesNotMatch(source, /clients\.claim\(|registration\.active\.postMessage\(\{ type: ['"]SKIP_WAITING/);
    }
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
