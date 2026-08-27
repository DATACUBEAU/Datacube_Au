import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const route = readFileSync('src/app/api/admin/limits/user-usage/route.ts', 'utf8');

assert.match(route, /code: 'user_usage_load_failed'/);
assert.match(route, /code: 'user_usage_update_failed'/);
assert.match(route, /use the request ID if you need support/);
assert.doesNotMatch(route, /String\(error\?\.message/);
assert.doesNotMatch(route, /message:\s*error\?\.message/);

console.log('PASS admin usage API does not expose raw internal failure messages');
