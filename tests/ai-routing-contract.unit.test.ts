import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
function read(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), 'utf8');
}
function run(name: string, fn: () => void) {
  try { fn(); console.log(`PASS ${name}`); }
  catch (error: any) { console.error(`FAIL ${name}`); console.error(error?.stack || error); process.exitCode = 1; }
}

run('retired browser AI actions fail closed with the native-app-required contract', () => {
  const actions = read('src/app/actions.ts');
  assert.match(actions, /throwMobileAppRequired/);
  assert.match(actions, /Knowledge generation/);
  assert.match(actions, /Exam predictions/);
  assert.match(actions, /Practice exam generation/);
  assert.match(actions, /Document question answering/);
  assert.match(actions, /AI prompt starters/);
  assert.doesNotMatch(actions, /vps-ticket|fetch\(['"`].*gateway/i);
});

run('retired VPS ticket and gateway source files are not required by the active application', () => {
  const workflow = read('.github/workflows/critical-saas-gates.yml');
  assert.doesNotMatch(workflow, /src\/lib\/server\/vps-ticket-config\.ts/);
  assert.doesNotMatch(workflow, /src\/app\/api\/au\/vps-ticket/);
  assert.doesNotMatch(workflow, /vps-ai-gateway\/src/);
});

run('model routing continues to reject hidden and internal model identifiers', () => {
  const contract = require(path.join(root, 'shared', 'ai-gateway-contract.cjs'));
  const routing = read('src/lib/server/ai-routing.ts');
  assert.equal(contract.isHiddenOrInternalModelId('internal/expensive-admin-model'), true);
  assert.equal(contract.isHiddenOrInternalModelId('hidden/provider-only'), true);
  assert.equal(contract.isHiddenOrInternalModelId('vendor/model:internal'), true);
  assert.equal(contract.isHiddenOrInternalModelId('meta-llama/llama-3.1-70b-instruct'), false);
  assert.match(routing, /isHiddenOrInternalModelId\(requested\)/);
  assert.match(routing, /hidden_or_internal_model/);
});

run('paid model routing uses the canonical registry and excludes the legacy paid table', () => {
  const routing = read('src/lib/server/ai-routing.ts');
  assert.match(routing, /const MODEL_REGISTRY_TABLE = 'au_models_registry'/);
  assert.match(routing, /\.eq\('is_free', false\)/);
  assert.doesNotMatch(routing, /au_pro_models_registry/);
  assert.doesNotMatch(routing, /MODEL_REGISTRY_TABLES/);
});
