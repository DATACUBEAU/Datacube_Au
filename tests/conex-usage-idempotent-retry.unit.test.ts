import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const pagePath = path.join(process.cwd(), 'src/app/conex/usage/page.tsx');
const source = fs.readFileSync(pagePath, 'utf8');

assert.match(
  source,
  /const adjustmentRequestRef = useRef<\{ fingerprint: string; requestId: string \} \| null>\(null\);/,
  'Conex usage must retain one adjustment request identity across ambiguous retries',
);

assert.match(
  source,
  /const resetAllRequestRef = useRef<\{ fingerprint: string; requestId: string \} \| null>\(null\);/,
  'Conex hard reset must retain one request identity across ambiguous retries',
);

assert.match(
  source,
  /const adjustmentFingerprint = JSON\.stringify\([\s\S]*?metricKey: editingMetric\.key[\s\S]*?action,[\s\S]*?amount: action === 'reset' \? null : numericAmount[\s\S]*?reason: reason\.trim\(\)[\s\S]*?\);/,
  'adjustment request identity must be bound to the immutable logical operation, not a button click',
);

assert.match(
  source,
  /adjustmentRequestRef\.current\?\.fingerprint === adjustmentFingerprint[\s\S]*?adjustmentRequestRef\.current\.requestId[\s\S]*?`conex-usage:\$\{crypto\.randomUUID\(\)\}`/,
  'a retry of the same adjustment must reuse the original idempotency key',
);

assert.match(
  source,
  /adjustmentRequestRef\.current = \{ fingerprint: adjustmentFingerprint, requestId \};[\s\S]*?requestId,/,
  'the request identity must be retained before the network call begins',
);

assert.match(
  source,
  /if \(!res\.ok\) throw await responseError\(res, 'Unable to update usage\.'\);[\s\S]*?adjustmentRequestRef\.current = null;[\s\S]*?setEditingMetric\(null\);/,
  'the adjustment idempotency key must rotate only after a confirmed successful response',
);

assert.match(
  source,
  /const resetAllFingerprint = JSON\.stringify\([\s\S]*?userId: targetUserId[\s\S]*?reason: resetAllReason\.trim\(\)[\s\S]*?\);/,
  'hard-reset request identity must be bound to the selected user and reason',
);

assert.match(
  source,
  /resetAllRequestRef\.current\?\.fingerprint === resetAllFingerprint[\s\S]*?resetAllRequestRef\.current\.requestId[\s\S]*?`conex-hard-reset:\$\{crypto\.randomUUID\(\)\}`/,
  'a retry of the same hard reset must reuse the original idempotency key',
);

assert.match(
  source,
  /if \(!res\.ok\) throw await responseError\(res, 'Unable to reset usage\.'\);[\s\S]*?resetAllRequestRef\.current = null;[\s\S]*?setResetAllOpen\(false\);/,
  'the hard-reset idempotency key must rotate only after confirmed success',
);

assert.doesNotMatch(
  source,
  /requestId: `conex-(?:usage|hard-reset):\$\{crypto\.randomUUID\(\)\}`/,
  'request IDs must not be generated inline for every Apply/Reset click',
);

console.log('Conex usage idempotent retry regression passed');
