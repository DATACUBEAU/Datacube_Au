export type DashboardFeatureKey =
  | 'global_chat'
  | 'knowledge_hub'
  | 'exam_prediction'
  | 'practice_exam_generation';

export type FeatureFlagRecordLike = {
  enabled?: boolean | null;
};

export type FeatureFlagsRecordMapLike = Record<string, FeatureFlagRecordLike | undefined>;

export type EffectiveEntitlementsLike = {
  plan?: string | null;
  hasPro?: boolean | null;
};

export type DashboardFeatureAccess = {
  key: DashboardFeatureKey;
  label: string;
  enabled: boolean;
  proRequired: boolean;
  paidAccess: boolean;
  allowed: boolean;
  code: 'FEATURE_DISABLED' | 'PRO_REQUIRED' | null;
  message: string;
};

function isFlagEnabled(
  records: FeatureFlagsRecordMapLike,
  key: string,
  defaultEnabled = true,
): boolean {
  const row = records[key];
  if (!row) return defaultEnabled;
  return row.enabled !== false;
}

export function hasPaidFeatureAccess(entitlements: EffectiveEntitlementsLike): boolean {
  return (
    entitlements.plan === 'admin' ||
    entitlements.plan === 'premium' ||
    entitlements.plan === 'pro' ||
    entitlements.plan === 'promo_pro' ||
    Boolean(entitlements.hasPro)
  );
}

export function getDashboardFeatureAccess(
  key: DashboardFeatureKey,
  entitlements: EffectiveEntitlementsLike,
  records: FeatureFlagsRecordMapLike,
): DashboardFeatureAccess {
  const paidAccess = hasPaidFeatureAccess(entitlements);

  if (key === 'global_chat') {
    const enabled = isFlagEnabled(records, 'global_chat_enabled', true);
    const proRequired = true;
    const allowed = enabled && (paidAccess || entitlements.plan === 'admin');
    return {
      key,
      label: 'Global Chat',
      enabled,
      proRequired,
      paidAccess,
      allowed,
      code: enabled ? (allowed ? null : 'PRO_REQUIRED') : 'FEATURE_DISABLED',
      message: enabled ? 'Global Chat requires Pro.' : 'Global Chat is currently disabled.',
    };
  }

  if (key === 'knowledge_hub') {
    const enabled = isFlagEnabled(records, 'enable_knowledge_hub', true);
    const proRequired = isFlagEnabled(records, 'pro_required_knowledge_hub', true);
    const allowed = enabled && (!proRequired || paidAccess || entitlements.plan === 'admin');
    return {
      key,
      label: 'Knowledge Hub',
      enabled,
      proRequired,
      paidAccess,
      allowed,
      code: enabled ? (allowed ? null : 'PRO_REQUIRED') : 'FEATURE_DISABLED',
      message: enabled ? 'Knowledge Hub requires Pro.' : 'Knowledge Hub is currently disabled.',
    };
  }

  if (key === 'exam_prediction') {
    const enabled = isFlagEnabled(records, 'enable_exam_prediction', true);
    const proRequired = isFlagEnabled(records, 'pro_required_exam_prediction', true);
    const allowed = enabled && (!proRequired || paidAccess || entitlements.plan === 'admin');
    return {
      key,
      label: 'Exam Prediction Engine',
      enabled,
      proRequired,
      paidAccess,
      allowed,
      code: enabled ? (allowed ? null : 'PRO_REQUIRED') : 'FEATURE_DISABLED',
      message: enabled ? 'Exam Prediction Engine requires Pro.' : 'Exam Prediction Engine is currently disabled.',
    };
  }

  const enabled = isFlagEnabled(records, 'enable_practice_exam_generation', true);
  const proRequired = true;
  const allowed = enabled && (paidAccess || entitlements.plan === 'admin');
  return {
    key,
    label: 'Practice Exam Center',
    enabled,
    proRequired,
    paidAccess,
    allowed,
    code: enabled ? (allowed ? null : 'PRO_REQUIRED') : 'FEATURE_DISABLED',
    message: enabled ? 'Practice Exam Center requires Pro.' : 'Practice Exam Center is currently disabled.',
  };
}

export function buildUpgradeContext(access: DashboardFeatureAccess) {
  return {
    code: access.code || 'PRO_REQUIRED',
    reason: access.message,
    message: access.message,
    key: access.key,
    limit: access.key,
    used: 0,
    cta: 'Upgrade to Pro',
    upgradeUrl: `/pricing?source=feature_${encodeURIComponent(access.key)}`,
  };
}
