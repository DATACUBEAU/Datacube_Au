import type { TierFeatureKey } from '../tier/policy';
import { resolveAiGatewayOperation } from '../../../shared/ai-gateway-contract';

export type VpsTicketOperation = {
  requestFeature: string;
  featureKey: TierFeatureKey;
  gatewayRoute: string;
  usageFeature: string;
};

const EXPLICIT_DEV_SECRET_FLAG = 'DCAU_ALLOW_INSECURE_DEV_VPS_SECRET';
const LOCAL_DEV_SHARED_SECRET = 'dcau-explicit-local-dev-vps-secret';

export type VpsSharedSecretResolution =
  | { ok: true; secret: Uint8Array; source: 'env' | 'explicit_dev' }
  | { ok: false; status: 503; code: 'VPS_SHARED_SECRET_MISSING'; message: string };

type VpsSharedSecretEnv =
  Partial<Record<'VPS_SHARED_SECRET' | 'NODE_ENV' | 'DCAU_ALLOW_INSECURE_DEV_VPS_SECRET', string | undefined>> &
  Record<string, string | undefined>;

export function resolveVpsTicketOperation(value: unknown): VpsTicketOperation | null {
  const operation = resolveAiGatewayOperation(value || 'chat');
  if (!operation) return null;
  return {
    requestFeature: operation.requestFeature,
    featureKey: operation.featureKey as TierFeatureKey,
    gatewayRoute: operation.gatewayRoute,
    usageFeature: operation.usageFeature,
  };
}

export function resolveVpsSharedSecretForSigning(
  env: VpsSharedSecretEnv = process.env,
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
