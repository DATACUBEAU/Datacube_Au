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

run('Next.js ticket issuance and VPS auth both import the shared route contract', () => {
  const ticketConfig = readRepoFile('src/lib/server/vps-ticket-config.ts');
  const gatewayAuth = readRepoFile('vps-ai-gateway/src/auth.ts');

  assert.match(ticketConfig, /ai-gateway-contract/);
  assert.match(ticketConfig, /resolveAiGatewayOperation/);
  assert.match(gatewayAuth, /\.\.\/\.\.\/shared\/ai-gateway-contract\.cjs/);
  assert.match(gatewayAuth, /routeRequirementForGatewayPath/);
  assert.doesNotMatch(ticketConfig, /const VPS_TICKET_OPERATIONS/);
  assert.doesNotMatch(gatewayAuth, /const GATEWAY_ROUTE_REQUIREMENTS/);
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

run('provider fallback remains downstream of usage reservation instead of issuing free provider attempts', () => {
  const ticketRoute = readRepoFile('src/app/api/au/vps-ticket/route.ts');
  const gatewayChat = readRepoFile('vps-ai-gateway/src/chat-handler.ts');
  const gatewayGeneration = readRepoFile('vps-ai-gateway/src/generation-handler.ts');

  assert.match(ticketRoute, /reserveAiUsage/);
  assert.match(ticketRoute, /reservation_id:\s*reservation\.reservationId/);
  assert.match(gatewayChat, /beginUsageReservation/);
  assert.match(gatewayChat, /commitUsageReservation/);
  assert.match(gatewayChat, /safeReleaseUsageReservation/);
  assert.match(gatewayGeneration, /beginUsageReservation/);
  assert.match(gatewayGeneration, /commitUsageReservation/);
  assert.match(gatewayGeneration, /safeReleaseUsageReservation/);
});

run('VPS provider routing uses the same plan and default-model contract as ticket issuance', () => {
  const gatewayRouting = readRepoFile('vps-ai-gateway/src/ai-routing.ts');

  assert.match(gatewayRouting, /\.\.\/\.\.\/shared\/ai-gateway-contract\.cjs/);
  assert.match(gatewayRouting, /defaultOpenRouterModelForPlan/);
  assert.match(gatewayRouting, /defaultAnthropicModelForPlan/);
  assert.match(gatewayRouting, /isPaidPlanCode/);
  assert.doesNotMatch(gatewayRouting, /new Set\(\['pro', 'premium'/);
});
