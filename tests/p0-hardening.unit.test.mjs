import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readBoundedWebhookBody } from '../src/lib/server/webhook-body.ts';
import { compareMigrationVersions } from '../scripts/check-migration-history.mjs';

test('webhook body limit is enforced on actual stream bytes', async () => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('1234'));
      controller.enqueue(encoder.encode('56'));
      controller.close();
    },
  });
  assert.equal(await readBoundedWebhookBody(new Request('https://example.invalid', {
    method: 'POST', body: stream, duplex: 'half', headers: { 'content-length': '2' },
  }), 5), null);
  assert.equal(await readBoundedWebhookBody(new Request('https://example.invalid', {
    method: 'POST', body: 'éé',
  }), 4), 'éé');
  assert.equal(await readBoundedWebhookBody(new Request('https://example.invalid', {
    method: 'POST', body: 'ok', headers: { 'content-length': '100' },
  }), 5), null);
});

test('provider authentication precedes the invalid-traffic limiter and billing processing', () => {
  for (const [provider, marker] of [
    ['paystack', 'if (!verifyPaystackWebhookSignature(rawBody, signature)) {'],
    ['flutterwave', 'if (!signatureValid) {'],
  ]) {
    const source = readFileSync('src/app/api/webhooks/' + provider + '/route.ts', 'utf8');
    const handler = source.slice(source.indexOf('export async function POST'));
    const invalid = handler.indexOf(marker);
    const limiter = handler.indexOf('consumeBillingRateLimit(');
    const denied = handler.indexOf("error: 'invalid_signature'");
    const admin = handler.indexOf('createSupabaseAdminClient()');
    assert.ok(invalid >= 0 && invalid < limiter && limiter < denied && denied < admin);
    assert.ok(handler.includes("scope: '" + provider + "-webhook-invalid-signature'"));
    assert.ok(handler.includes('readBoundedWebhookBody(req, WEBHOOK_MAX_BODY_BYTES)'));
    assert.ok(!handler.includes('await req.text()'));
  }
});

test('missing scanner credentials fail trusted changes rather than report a completed assessment', () => {
  const workflow = readFileSync('.github/workflows/strix-security-scan.yml', 'utf8');
  const missing = workflow.slice(workflow.indexOf('if [ -z'), workflow.indexOf('echo "configured=true"'));
  assert.ok(missing.includes('SAME_REPOSITORY'));
  assert.ok(missing.includes('exit 1'));
  assert.ok(missing.includes('Fork pull request'));
  assert.ok(!missing.includes('Pull-request scan is non-blocking while Strix is unconfigured'));
});

test('migration history detects both directions of drift and duplicate versions', () => {
  const report = compareMigrationVersions(['20260101000000_a.sql', '20260102000000_b.sql', '20260102000000_c.sql'], [{ version: '20260101000000' }, { version: '20260103000000' }]);
  assert.deepEqual(report, { missingFromRepository: ['20260103000000'], notRecordedLive: ['20260102000000'], duplicateRepositoryVersions: ['20260102000000'], duplicateLiveVersions: [] });
  assert.throws(() => compareMigrationVersions(['invalid.sql'], ['20260101000000']));
  assert.throws(() => compareMigrationVersions([], []));
});
