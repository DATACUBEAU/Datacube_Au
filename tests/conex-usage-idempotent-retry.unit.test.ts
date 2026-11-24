import assert from 'node:assert/strict';
import fs from 'node:fs';
const page = fs.readFileSync('src/app/conex/usage/page.tsx','utf8');
const guard = fs.readFileSync('src/app/api/feedback/_auth.ts','utf8');
assert.match(page, /redirect\('\/conex'\)/);
assert.doesNotMatch(page, /fetch\(|authedFetch|useEffect/);
assert.match(guard, /route\.startsWith\('\/api\/admin\/limits\/'\)/);
assert.match(guard, /LEGACY_ADMIN_CONTROL_RETIRED/);
console.log('Legacy Conex usage editor is retired; old client mutations are denied.');
