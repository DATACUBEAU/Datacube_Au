import assert from 'node:assert/strict';
import fs from 'node:fs';

const limitsSource = fs.readFileSync('src/lib/server/au-limits.ts', 'utf8');
const trackingSource = fs.readFileSync('src/lib/server/usage-tracking.ts', 'utf8');

let failed = 0;

type Test = () => void;

function run(name: string, fn: Test) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error: any) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error?.stack || error);
  }
}

function snapshotFunctionSource(): string {
  const start = limitsSource.indexOf('export async function buildUsageSnapshotForUser');
  assert.ok(start >= 0, 'buildUsageSnapshotForUser must exist');
  const nextExport = limitsSource.indexOf('\nexport ', start + 1);
  return limitsSource.slice(start, nextExport >= 0 ? nextExport : undefined);
}

run('one captured timestamp owns all reset windows in a usage snapshot', () => {
  const source = snapshotFunctionSource();

  assert.match(source, /const\s+snapshotAt\s*=\s*new Date\(\);/);

  for (const key of [
    'max_uploads_total',
    'max_exam_predictions',
    'max_practice_exams',
    'max_knowledge_hub',
    'max_chats_total',
    'max_tokens_total',
  ]) {
    assert.match(
      source,
      new RegExp(`computeResetWindow\\(limitRules\\.${key},\\s*snapshotAt\\)`),
      `${key} must use the snapshot timestamp`,
    );
  }

  assert.match(
    source,
    /loadUsageCounterSnapshots\(supabase,\s*userId,\s*snapshotAt\)/,
    'daily counter lookup must use the same snapshot timestamp',
  );
  assert.match(
    source,
    /computeResetWindow\(limitRules\[key\],\s*snapshotAt\)/,
    'the user-visible reset window must use the same snapshot timestamp',
  );
});

run('metric resolution consumes the caller-owned window instead of recomputing it later', () => {
  assert.match(
    trackingSource,
    /window\??:\s*ResetWindowSnapshot/,
    'resolveUsageMetricForRule must accept the caller-owned reset window',
  );
  assert.match(
    trackingSource,
    /const\s+snapshotAt\s*=\s*input\.snapshotAt\s*\?\?\s*new Date\(\);/,
    'resolver fallback time must be captured once',
  );
  assert.match(
    trackingSource,
    /const\s+window\s*=\s*input\.window\s*\?\?\s*computeResetWindow\(input\.rule,\s*snapshotAt\);/,
    'resolver must prefer the precomputed snapshot window',
  );
});

run('each usage-mode resolver call receives the matching frozen window', () => {
  const source = snapshotFunctionSource();
  const expectedPairs = [
    ['max_chats_total', 'chatWindow'],
    ['max_tokens_total', 'tokenWindow'],
    ['max_uploads_total', 'uploadWindow'],
    ['max_exam_predictions', 'predictionWindow'],
    ['max_practice_exams', 'practiceWindow'],
    ['max_knowledge_hub', 'knowledgeWindow'],
  ] as const;

  for (const [metricKey, windowName] of expectedPairs) {
    const callPattern = new RegExp(
      `metricKey:\\s*['\"]${metricKey}['\"][\\s\\S]{0,500}?window:\\s*${windowName}[\\s\\S]{0,120}?snapshotAt`,
    );
    assert.match(source, callPattern, `${metricKey} must resolve against ${windowName}`);
  }
});

if (failed > 0) {
  process.exitCode = 1;
}
