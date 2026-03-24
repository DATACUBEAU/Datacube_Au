import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

let failed = 0;

type AsyncTest = () => void | Promise<void>;

const repoRoot = path.resolve(__dirname, '..');

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

async function run(name: string, fn: AsyncTest) {
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
  await run('safeFetch no longer hard-redirects on every 401 response', () => {
    const source = readRepoFile('src/lib/api/safe-fetch.ts');
    assert.equal(source.includes('window.location.href = loginUrl'), false);
    assert.match(source, /authIntent = 'background'/);
  });

  await run('invokeEdgeFunction owns auth escalation instead of delegating it to safeFetch', () => {
    const source = readRepoFile('src/lib/supabase-client/client.ts');
    assert.match(source, /suppressAuthError:\s*true/);
    assert.match(source, /reauthOnAuthFailure/);
    assert.match(source, /authIntent,\s*\n/);
  });

  await run('background analytics logging cannot force a full-page reauthenticate flow', () => {
    const source = readRepoFile('src/lib/analytics.ts');
    assert.match(source, /authIntent:\s*'background'/);
    assert.match(source, /reauthOnAuthFailure:\s*false/);
  });

  await run('feature output waits for auth restore before firing protected requests', () => {
    const source = readRepoFile('src/hooks/api/use-feature-output.ts');
    assert.match(source, /shouldDeferProtectedRequest/);
    assert.match(source, /isRestoringAuth/);
    assert.match(source, /suppressAuthError:\s*true/);
  });

  await run('smart auth bootstrap starts in a loading state until restore settles', () => {
    const source = readRepoFile('src/hooks/use-smart-auth.tsx');
    assert.match(source, /useState<'loading' \| 'authenticated' \| 'unauthenticated'>\('loading'\)/);
  });

  if (failed > 0) {
    process.exit(1);
  }
}

void main();
