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
  await run('user-facing error copy distinguishes generic 401 from explicit session expiry', () => {
    const source = readRepoFile('src', 'lib', 'api', 'user-facing-error.ts');
    assert.match(source, /function isExplicitSessionExpiry/);
    assert.match(source, /SESSION_EXPIRED/);
    assert.match(source, /REAUTH_REQUIRED/);
    assert.match(source, /TOKEN_EXPIRED/);
    assert.match(source, /JWT_EXPIRED/);
    assert.match(source, /REFRESH_FAILED/);
    assert.match(source, /title:\s*sessionExpired \? 'Session expired' : 'Sign in required'/);
    assert.match(source, /description:\s*sessionExpired[\s\S]+\? 'Your session expired\. Please sign in again\.'/);
    assert.match(source, /: 'Please sign in again, then retry this action\.'/);
    assert.doesNotMatch(source, /title:\s*'Session expired'[\s\S]+description:\s*'Your session expired\. Please refresh the page and sign in again\.'/);
  });

  await run('protected API test suite asserts generic AI 401 stays endpoint scoped', () => {
    const source = readRepoFile('tests', 'protected-api-pipeline.unit.test.ts');
    assert.match(source, /safeFetch no longer hard-redirects on every 401 response/);
    assert.match(source, /AI ticket requests suppress global 401 expiry/);
  });

  if (failed > 0) {
    process.exit(1);
  }
}

void main();
