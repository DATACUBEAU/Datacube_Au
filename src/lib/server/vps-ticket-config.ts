import type { TierFeatureKey } from '../tier/policy';

export type VpsTicketOperation = {
  requestFeature: string;
  featureKey: TierFeatureKey;
  gatewayRoute: string;
  usageFeature: string;
};

type OperationDefinition = Omit<VpsTicketOperation, 'requestFeature'>;

const EXPLICIT_DEV_SECRET_FLAG = 'DCAU_ALLOW_INSECURE_DEV_VPS_SECRET';
const LOCAL_DEV_SHARED_SECRET = 'dcau-explicit-local-dev-vps-secret';

const VPS_TICKET_OPERATIONS = {
  chat: { featureKey: 'au_chat', gatewayRoute: '/chat/au-chat', usageFeature: 'au-chat' },
  'au-chat': { featureKey: 'au_chat', gatewayRoute: '/chat/au-chat', usageFeature: 'au-chat' },
  au_chat: { featureKey: 'au_chat', gatewayRoute: '/chat/au-chat', usageFeature: 'au-chat' },
  'global-chat': { featureKey: 'global_chat', gatewayRoute: '/chat/global-chat', usageFeature: 'global-chat' },
  global_chat: { featureKey: 'global_chat', gatewayRoute: '/chat/global-chat', usageFeature: 'global-chat' },
  'generate-knowledge': { featureKey: 'knowledge_generation', gatewayRoute: '/generate/knowledge', usageFeature: 'generate-knowledge' },
  knowledge: { featureKey: 'knowledge_generation', gatewayRoute: '/generate/knowledge', usageFeature: 'generate-knowledge' },
  knowledge_hub: { featureKey: 'knowledge_generation', gatewayRoute: '/generate/knowledge', usageFeature: 'generate-knowledge' },
  knowledge_generation: { featureKey: 'knowledge_generation', gatewayRoute: '/generate/knowledge', usageFeature: 'generate-knowledge' },
  'exam-generator': { featureKey: 'practice_exam_generation', gatewayRoute: '/generate/practice-exam', usageFeature: 'generate-practice-exam' },
  'generate-practice-exam': { featureKey: 'practice_exam_generation', gatewayRoute: '/generate/practice-exam', usageFeature: 'generate-practice-exam' },
  practice: { featureKey: 'practice_exam_generation', gatewayRoute: '/generate/practice-exam', usageFeature: 'generate-practice-exam' },
  practice_exam_generation: { featureKey: 'practice_exam_generation', gatewayRoute: '/generate/practice-exam', usageFeature: 'generate-practice-exam' },
  'prediction-engine': { featureKey: 'exam_predictions', gatewayRoute: '/generate/exam-predictions', usageFeature: 'generate-exam-predictions' },
  'generate-exam-predictions': { featureKey: 'exam_predictions', gatewayRoute: '/generate/exam-predictions', usageFeature: 'generate-exam-predictions' },
  exam_prediction: { featureKey: 'exam_predictions', gatewayRoute: '/generate/exam-predictions', usageFeature: 'generate-exam-predictions' },
  exam_predictions: { featureKey: 'exam_predictions', gatewayRoute: '/generate/exam-predictions', usageFeature: 'generate-exam-predictions' },
  'generate-prompt-starters': { featureKey: 'prompt_starters', gatewayRoute: '/generate/prompt-starters', usageFeature: 'generate-prompt-starters' },
  prompt_starters: { featureKey: 'prompt_starters', gatewayRoute: '/generate/prompt-starters', usageFeature: 'generate-prompt-starters' },
} satisfies Record<string, OperationDefinition>;

export type VpsSharedSecretResolution =
  | { ok: true; secret: Uint8Array; source: 'env' | 'explicit_dev' }
  | { ok: false; status: 503; code: 'VPS_SHARED_SECRET_MISSING'; message: string };

function normalizeToken(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

export function resolveVpsTicketOperation(value: unknown): VpsTicketOperation | null {
  const requestFeature = normalizeToken(value || 'chat');
  const operation = VPS_TICKET_OPERATIONS[requestFeature as keyof typeof VPS_TICKET_OPERATIONS];
  if (!operation) return null;
  return {
    requestFeature,
    ...operation,
  };
}

export function resolveVpsSharedSecretForSigning(
  env: Partial<Record<'VPS_SHARED_SECRET' | 'NODE_ENV' | 'DCAU_ALLOW_INSECURE_DEV_VPS_SECRET', string | undefined>> = process.env,
): VpsSharedSecretResolution {
  const configured = String(env.VPS_SHARED_SECRET || '').trim();
  if (configured) {
    return { ok: true, secret: new TextEncoder().encode(configured), source: 'env' };
  }

  const isProduction = env.NODE_ENV === 'production';
  const allowExplicitDevSecret = env[EXPLICIT_DEV_SECRET_FLAG] === '1';
  if (!isProduction && allowExplicitDevSecret) {
    return { ok: true, secret: new TextEncoder().encode(LOCAL_DEV_SHARED_SECRET), source: 'explicit_dev' };
  }

  return {
    ok: false,
    status: 503,
    code: 'VPS_SHARED_SECRET_MISSING',
    message: 'AI gateway ticket signing is not configured.',
  };
}
