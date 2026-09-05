import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const accounting = readFileSync('vps-ai-gateway/src/usage-accounting.ts', 'utf8');
const handler = readFileSync('vps-ai-gateway/src/generation-handler.ts', 'utf8');

assert.match(
  accounting,
  /const rejectionCode = result\.code\s*\? `USAGE_BEGIN_\$\{result\.code\}`\s*:\s*'USAGE_BEGIN_REJECTED';/,
  'every rejected begin RPC result must be classified as a begin-phase accounting error',
);
assert.match(
  accounting,
  /accountingStatus\(result\.code, result\.status\),\s*rejectionCode,/,
  'begin rejection must preserve the database result for HTTP status classification while exposing begin-phase settlement identity',
);
assert.match(
  accounting,
  /if \(code === 'USAGE_PROVIDER_TICKET_ALREADY_ACCEPTED'\) return 409;/,
  'an already-accepted provider ticket is a deterministic conflict, not a retryable server failure',
);
assert.match(
  handler,
  /input\.error instanceof UsageAccountingError && input\.error\.code\.startsWith\('USAGE_BEGIN'\)\) return;/,
  'generation failure settlement must not release a reservation when begin was rejected',
);
assert.doesNotMatch(
  accounting,
  /commitUsageReservation[\s\S]{0,1200}`USAGE_BEGIN_\$\{result\.code\}`/,
  'commit failures must not be mislabeled as begin failures',
);
assert.doesNotMatch(
  accounting,
  /releaseUsageReservation[\s\S]{0,1200}`USAGE_BEGIN_\$\{result\.code\}`/,
  'release failures must not be mislabeled as begin failures',
);

console.log('AI usage begin settlement safety regressions passed');
