'use client';

import type { BillingReturnState } from './payment-return';
import { resolveDisplayedPlanCode, type BillingSnapshotLike } from './plan-refresh-state';

export const SUBSCRIPTION_USAGE_KEYS = [
  'max_chats_total',
  'max_uploads_total',
  'max_tokens_total',
  'max_file_size_mb',
  'max_concurrent_jobs',
  'max_exam_predictions',
  'max_practice_exams',
  'max_knowledge_hub',
] as const;

type SubscriptionUsageKey = (typeof SUBSCRIPTION_USAGE_KEYS)[number];

type SubscriptionUsageInput = {
  plan: string | null;
  limits: Record<string, number>;
  limitRules: Record<string, Record<string, unknown>>;
  usageByLimit: Record<string, Record<string, unknown>>;
};

export type SubscriptionUsageRow = {
  key: SubscriptionUsageKey;
  label: string;
  used: number;
  limit: number | null;
  resetText: string;
};

const USAGE_FALLBACK_LABELS: Record<SubscriptionUsageKey, string> = {
  max_chats_total: 'AI chats',
  max_uploads_total: 'Document uploads',
  max_tokens_total: 'AI tokens',
  max_file_size_mb: 'File size per upload',
  max_concurrent_jobs: 'Simultaneous processing jobs',
  max_exam_predictions: 'Exam predictions',
  max_practice_exams: 'Practice exams',
  max_knowledge_hub: 'Knowledge Hub items',
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function humanizeUsageKey(key: string): string {
  return key
    .replace(/^max_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatUsageAmount(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Math.max(0, value));
}

function buildUsageGuidance(key: SubscriptionUsageKey, used: number, limit: number | null): string {
  const safeUsed = Math.max(0, used);

  if (key === 'max_file_size_mb') {
    if (limit === null) return 'No file-size limit';
    return `Up to ${formatUsageAmount(limit)} MB per file`;
  }

  if (key === 'max_concurrent_jobs') {
    if (limit === null) return 'Unlimited simultaneous processing';
    const safeLimit = Math.max(0, limit);
    if (safeLimit === 0) return 'No simultaneous processing slots';
    const active = Math.min(safeUsed, safeLimit);
    const available = Math.max(0, safeLimit - active);
    return `${formatUsageAmount(active)} of ${formatUsageAmount(safeLimit)} processing slots active · ${formatUsageAmount(available)} available`;
  }

  if (limit === null) return 'Unlimited usage';

  const safeLimit = Math.max(0, limit);
  if (safeLimit === 0) {
    return safeUsed > 0 ? 'Limit reached' : 'No usage available';
  }

  const remaining = Math.max(0, safeLimit - safeUsed);
  const percentUsed = Math.min(100, Math.round((safeUsed / safeLimit) * 100));
  const remainingLabel = `${formatUsageAmount(remaining)} remaining`;

  if (safeUsed >= safeLimit) return 'Limit reached · 100% used';
  if (percentUsed >= 90) return `Almost at limit · ${remainingLabel} · ${percentUsed}% used`;
  if (percentUsed >= 75) return `Approaching limit · ${remainingLabel} · ${percentUsed}% used`;
  return `${remainingLabel} · ${percentUsed}% used`;
}

function buildPaymentReturnSignature(paymentReturn: BillingReturnState): string {
  return [
    paymentReturn.reference || '',
    paymentReturn.verificationTarget || '',
    paymentReturn.transactionId || '',
    paymentReturn.gatewayHint || '',
    paymentReturn.isSuccess ? '1' : '0',
    paymentReturn.isCanceled ? '1' : '0',
    paymentReturn.hasCallbackState ? '1' : '0',
  ].join('|');
}

export function buildSubscriptionBootstrapKey(
  userId: string | null | undefined,
  paymentReturn: BillingReturnState,
): string | null {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) return null;
  return `${normalizedUserId}:${buildPaymentReturnSignature(paymentReturn)}`;
}

export function hasMeaningfulSubscriptionUsageData(usage: Partial<SubscriptionUsageInput>): boolean {
  const usageByLimit = usage.usageByLimit || {};
  const limitRules = usage.limitRules || {};
  const limits = usage.limits || {};

  return SUBSCRIPTION_USAGE_KEYS.some((key) => {
    return (
      Object.keys(asRecord(usageByLimit[key])).length > 0 ||
      Object.keys(asRecord(limitRules[key])).length > 0 ||
      asFiniteNumber(limits[key]) !== null
    );
  });
}

export function buildSubscriptionUsageRows(input: {
  snapshot?: BillingSnapshotLike | null;
  currentPlanManagedPlan?: string | null;
  tier?: string | null;
  usage: SubscriptionUsageInput;
}): {
  planCode: string | null;
  isFreePlan: boolean;
  hasData: boolean;
  resetSummary: string[];
  rows: SubscriptionUsageRow[];
} {
  const planCode = resolveDisplayedPlanCode({
    snapshot: input.snapshot,
    currentPlanManagedPlan: input.currentPlanManagedPlan,
    tier: input.tier,
    limitsUsagePlan: input.usage.plan,
  });

  if (!planCode) {
    return {
      planCode: null,
      isFreePlan: false,
      hasData: false,
      resetSummary: [],
      rows: [],
    };
  }

  const resetSummary: string[] = [];
  const rows = SUBSCRIPTION_USAGE_KEYS.reduce<SubscriptionUsageRow[]>((acc, key) => {
      const rule = asRecord(input.usage.limitRules[key]);
      const presentation = asRecord(rule.presentation);
      const usageEntry = asRecord(input.usage.usageByLimit[key]);
      const reset = asRecord(usageEntry.reset);
      const rawLimit =
        usageEntry.limit === null || rule.is_unlimited === true
          ? null
          : (usageEntry.limit ?? input.usage.limits[key] ?? rule.value);
      const parsedLimit = rawLimit === null ? null : asFiniteNumber(rawLimit);
      const used = Math.max(0, asFiniteNumber(usageEntry.used) ?? 0);
      const label =
        asString(presentation.label) ||
        asString(rule.label) ||
        USAGE_FALLBACK_LABELS[key] ||
        humanizeUsageKey(key);
      const baseResetText =
        asString(reset.label) ||
        asString(presentation.reset_description) ||
        asString(presentation.reset_label);
      const hasAnyData =
        Object.keys(rule).length > 0 ||
        Object.keys(usageEntry).length > 0 ||
        parsedLimit !== null ||
        rawLimit === null;

      if (!hasAnyData) return acc;

      if (baseResetText && !resetSummary.includes(baseResetText) && resetSummary.length < 2) {
        resetSummary.push(baseResetText);
      }

      const usageGuidance = buildUsageGuidance(key, used, parsedLimit);
      acc.push({
        key,
        label,
        used,
        limit: parsedLimit,
        resetText: [baseResetText, usageGuidance].filter(Boolean).join(' · '),
      });
      return acc;
    }, []);

  return {
    planCode,
    isFreePlan: planCode === 'free',
    hasData: rows.length > 0,
    resetSummary,
    rows,
  };
}
