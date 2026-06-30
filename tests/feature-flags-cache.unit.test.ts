import assert from 'node:assert/strict';
import {
  buildFeatureFlagsEtag,
  ifNoneMatchIncludesEtag,
  type FeatureFlagEtagRow,
} from '../src/lib/feature-flags/http-cache.js';

let failed = 0;

function run(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error: any) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error?.stack || error);
  }
}

const rows: FeatureFlagEtagRow[] = [
  {
    key: 'billing_enabled',
    enabled: true,
    category: 'billing',
    description: 'Billing',
    scope: 'global',
    config: { b: 2, a: { z: true, y: false } },
    updated_at: '2026-06-30T10:00:00.000Z',
  },
  {
    key: 'global_chat_enabled',
    enabled: true,
    category: 'chat',
    description: 'Global chat',
    scope: 'global',
    config: {},
    updated_at: '2026-06-30T10:00:00.000Z',
  },
];

run('feature flag etag is stable for logical row and config ordering', () => {
  const reordered = [
    {
      ...rows[1],
      config: {},
    },
    {
      ...rows[0],
      config: { a: { y: false, z: true }, b: 2 },
    },
  ];

  assert.equal(buildFeatureFlagsEtag(rows), buildFeatureFlagsEtag(reordered));
});

run('feature flag etag changes when relevant payload changes', () => {
  const changed = rows.map((row) => row.key === 'billing_enabled' ? { ...row, enabled: false } : row);
  assert.notEqual(buildFeatureFlagsEtag(rows), buildFeatureFlagsEtag(changed));
});

run('if-none-match supports strong, weak, list, and wildcard validators', () => {
  const etag = buildFeatureFlagsEtag(rows);
  assert.equal(ifNoneMatchIncludesEtag(etag, etag), true);
  assert.equal(ifNoneMatchIncludesEtag(`W/${etag}`, etag), true);
  assert.equal(ifNoneMatchIncludesEtag(`"other", ${etag}`, etag), true);
  assert.equal(ifNoneMatchIncludesEtag('*', etag), true);
  assert.equal(ifNoneMatchIncludesEtag('"other"', etag), false);
  assert.equal(ifNoneMatchIncludesEtag(null, etag), false);
});

if (failed > 0) process.exit(1);
