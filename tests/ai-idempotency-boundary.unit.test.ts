import assert from 'node:assert/strict';
import { normalizeAiIdempotencyKey, reserveAiUsage } from '../src/lib/server/ai-usage-accounting.js';

let failed = 0;

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
  await run('missing AI idempotency identity is not replaced with a random billable key', () => {
    assert.equal(normalizeAiIdempotencyKey(undefined, 'chat'), '');
    assert.equal(normalizeAiIdempotencyKey(null, 'chat'), '');
    assert.equal(normalizeAiIdempotencyKey('   ', 'chat'), '');
  });

  await run('valid stable AI idempotency identity is preserved', () => {
    assert.equal(normalizeAiIdempotencyKey('chat_123456789abc', 'chat'), 'chat_123456789abc');
  });

  await run('missing identity is rejected before the reservation RPC can record usage', async () => {
    const calls: Array<{ name: string; payload: Record<string, unknown> }> = [];
    const supabase = {
      async rpc(name: string, payload: Record<string, unknown>) {
        calls.push({ name, payload });
        return { data: null, error: null };
      },
    };
    const idempotencyKey = normalizeAiIdempotencyKey(undefined, 'chat');
    const result = await reserveAiUsage({
      supabase: supabase as any,
      userId: '00000000-0000-4000-8000-000000000001',
      featureKey: 'au_chat',
      route: '/chat/au-chat',
      idempotencyKey,
      ticketId: 'ticket-1',
      reservation: {
        estimatedUnits: 768,
        increments: { max_chats_total: 1, api_calls: 1 },
        limitChecks: [],
        requestFingerprint: 'fingerprint',
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, 'INVALID_USAGE_RESERVATION');
    assert.equal(calls.length, 0);
  });

  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
