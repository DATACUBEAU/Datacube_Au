import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const contract = require(path.join(repoRoot, 'shared', 'ai-gateway-contract.cjs'));

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function run(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error: any) {
    console.error(`FAIL ${name}`);
    console.error(error?.stack || error);
    process.exitCode = 1;
  }
}

run('shared AI gateway contract resolves every browser-facing operation to a bound feature and route', () => {
  const expectations: Record<string, { featureKey: string; gatewayRoute: string }> = {
    'au-chat': { featureKey: 'au_chat', gatewayRoute: '/chat/au-chat' },
    'global-chat': { featureKey: 'global_chat', gatewayRoute: '/chat/global-chat' },
    'generate-knowledge': { featureKey: 'knowledge_generation', gatewayRoute: '/generate/knowledge' },
    'generate-practice-exam': { featureKey: 'practice_exam_generation', gatewayRoute: '/generate/practice-exam' },
    'generate-exam-predictions': { featureKey: 'exam_predictions', gatewayRoute: '/generate/exam-predictions' },
    'generate-prompt-starters': { featureKey: 'prompt_starters', gatewayRoute: '/generate/prompt-starters' },
  };

  for (const [requestFeature, expected] of Object.entries(expectations)) {
    const operation = contract.resolveAiGatewayOperation(requestFeature);
    assert.equal(operation?.featureKey, expected.featureKey, requestFeature);
    assert.equal(operation?.gatewayRoute, expected.gatewayRoute, requestFeature);

    const requirement = contract.routeRequirementForGatewayPath(`${expected.gatewayRoute}?ignored=true`);
    assert.equal(requirement?.featureKey, expected.featureKey, expected.gatewayRoute);
  }
});

run('the admin routing endpoint uses the canonical server routing module after authorizing the request', () => {
  const route = readRepoFile('src/app/api/admin/model-routing/route.ts');
  assert.match(route, /import \{ getModelRoutingFlags \} from '@\/lib\/server\/ai-routing'/);
  assert.match(route, /await requireAdmin\(req\);\s*const flags = await getModelRoutingFlags\(supabase\);/);
});

run('hidden or internal model names are rejected by the shared contract and server model validator', () => {
  const routing = readRepoFile('src/lib/server/ai-routing.ts');

  assert.equal(contract.isHiddenOrInternalModelId('internal/expensive-admin-model'), true);
  assert.equal(contract.isHiddenOrInternalModelId('hidden/provider-only'), true);
  assert.equal(contract.isHiddenOrInternalModelId('vendor/model:internal'), true);
  assert.equal(contract.isHiddenOrInternalModelId('meta-llama/llama-3.1-70b-instruct'), false);
  assert.match(routing, /isHiddenOrInternalModelId\(requested\)/);
  assert.match(routing, /hidden_or_internal_model/);
});

run('the shared provider defaults restrict paid models to paid plans', () => {
  for (const plan of ['free', 'unknown', null]) {
    assert.equal(contract.isPaidPlanCode(plan), false);
    assert.equal(contract.defaultOpenRouterModelForPlan(plan), contract.DEFAULT_OPENROUTER_FREE_MODEL);
    assert.equal(contract.defaultAnthropicModelForPlan(plan), null);
  }
  for (const plan of ['pro', 'monthly', 'premium', 'promo_pro']) {
    assert.equal(contract.isPaidPlanCode(plan), true);
    assert.equal(contract.defaultOpenRouterModelForPlan(plan), contract.DEFAULT_OPENROUTER_PAID_MODEL);
    assert.equal(contract.defaultAnthropicModelForPlan(plan), contract.DEFAULT_ANTHROPIC_PAID_MODEL);
  }
});

run('paid model routing reads one canonical registry and excludes the legacy paid table', () => {
  const routing = readRepoFile('src/lib/server/ai-routing.ts');

  assert.match(routing, /const MODEL_REGISTRY_TABLE = 'au_models_registry'/);
  assert.match(routing, /\.eq\('is_free', false\)/);
  assert.doesNotMatch(routing, /au_pro_models_registry/);
  assert.doesNotMatch(routing, /MODEL_REGISTRY_TABLES/);
});
