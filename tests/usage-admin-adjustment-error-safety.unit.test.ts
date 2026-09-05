import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const sourcePath = path.join(process.cwd(), 'src/lib/server/usage-tracking.ts');
const source = fs.readFileSync(sourcePath, 'utf8');

assert.match(
  source,
  /function\s+isMissingUsageAdminAdjustmentRpcError\s*\(/,
  'admin-adjustment rollout compatibility must use a dedicated missing-RPC classifier',
);
assert.match(
  source,
  /code\s*===\s*'42883'/,
  'PostgreSQL undefined-function errors must remain compatible during rolling deployment',
);
assert.match(
  source,
  /code\s*===\s*'PGRST202'/,
  'PostgREST missing-function schema-cache errors must remain compatible during rolling deployment',
);
assert.match(
  source,
  /context\.includes\('get_usage_admin_adjustment_total'\)/,
  'missing-RPC compatibility must be scoped to the adjustment RPC itself',
);

const loaderMatch = source.match(
  /async function loadUsageAdminAdjustmentTotal[\s\S]*?\n}\n\nexport function buildUsageEventKey/,
);
assert.ok(loaderMatch, 'expected admin-adjustment loader to be present');
const loader = loaderMatch[0];

assert.match(
  loader,
  /isMissingUsageAdminAdjustmentRpcError\(error\)/,
  'the adjustment loader must use the narrow missing-RPC classifier',
);
assert.doesNotMatch(
  loader,
  /isSchemaDriftError\(error\)/,
  'unexpected PostgREST errors must not be silently treated as zero adjustment',
);

console.log('usage admin adjustment error safety regression passed');
