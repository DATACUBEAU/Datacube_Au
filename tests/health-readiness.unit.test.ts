import assert from 'node:assert/strict';
import { runReadinessProbe } from '../src/lib/server/health-readiness.js';

let failed = 0;

type TestFn = () => void | Promise<void>;

async function run(name: string, fn: TestFn) {
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
  await run('healthy datastore probe reports ready without exposing internals', async () => {
    const result = await runReadinessProbe({
      check: async () => undefined,
      timeoutMs: 1000,
    });

    assert.equal(result.ok, true);
    assert.equal(result.dependency, 'ok');
    assert.equal(Number.isFinite(result.durationMs), true);
  });

  await run('failed datastore probe reports unavailable without error payloads', async () => {
    const result = await runReadinessProbe({
      check: async () => {
        throw new Error('sensitive database implementation detail');
      },
      timeoutMs: 1000,
    });

    assert.deepEqual(Object.keys(result).sort(), ['dependency', 'durationMs', 'ok']);
    assert.equal(result.ok, false);
    assert.equal(result.dependency, 'unavailable');
    assert.equal(JSON.stringify(result).includes('sensitive'), false);
  });

  await run('hung datastore probe is bounded and aborts the dependency request', async () => {
    let signalWasAborted = false;
    const result = await runReadinessProbe({
      timeoutMs: 100,
      check: async (signal) => {
        await new Promise<void>(() => {
          signal.addEventListener('abort', () => {
            signalWasAborted = true;
          }, { once: true });
        });
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.dependency, 'timeout');
    assert.equal(signalWasAborted, true);
    assert.ok(result.durationMs >= 90);
    assert.ok(result.durationMs < 1000);
  });

  if (failed > 0) {
    process.exit(1);
  }
}

void main();
