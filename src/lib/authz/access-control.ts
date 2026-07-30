import {
  TIER_FEATURE_POLICIES,
  featureUpgradeHref,
  isFeatureAllowedForTier,
  type TierFeatureKey,
  type TierId,
} from '@/lib/tier/policy';
import { isPaidAdminOverridePlan, normalizeAdminOverridePlan, type AdminOverridePlan } from '@/lib/admin/protected-owner';

export type AccessRequirement = 'auth' | 'feature' | 'paid' | 'admin';
export type AccessSurface = 'page' | 'api' | 'server_action' | 'vps' | 'navigation' | 'worker';
export type AccessMatch = 'exact' | 'prefix';
export type ProtectedLabel =
  | 'AUTH'
  | 'PRO'
  | 'PREMIUM'
  | 'ADMIN'
  | 'STAFF'
  | 'INTERNAL'
  | 'BILLING'
  | 'UPLOAD'
  | 'AI'
  | 'CACHE_SENSITIVE';

export type AccessRule = {
  id: string;
  surface: AccessSurface;
  pathname: string;
  match: AccessMatch;
  requirement: AccessRequirement;
  feature?: TierFeatureKey;
  labels: readonly ProtectedLabel[];
  description: string;
  noStore: true;
};

export type EntitlementSubject = {
  userId?: string | null;
  email?: string | null;
  plan?: string | null;
  profileTier?: string | null;
  hasPro?: boolean | null;
  entitlementSource?: string | null;
  entitlementEndsAt?: string | null;
  promoActive?: boolean | null;
  promoEndsAtUtc?: string | null;
  adminOverride?: boolean | null;
  adminOverridePlan?: AdminOverridePlan | null;
  suspended?: boolean | null;
};

export type AccessDecisionCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'UPGRADE_REQUIRED'
  | 'ENTITLEMENT_EXPIRED'
  | 'ACCOUNT_SUSPENDED';

export type AccessDecision = {
  allowed: boolean;
  status: 200 | 401 | 403;
  code: AccessDecisionCode | null;
  reason: string | null;
  requirement: AccessRequirement;
  feature?: TierFeatureKey;
  routeId?: string;
  upgradeUrl?: string;
  plan: TierId;
  labels: readonly ProtectedLabel[];
};

export const ACCESS_NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, private',
  Pragma: 'no-cache',
  Expires: '0',
  Vary: 'Cookie, Authorization',
} as const;

export const PROTECTED_PAGE_RULES: readonly AccessRule[] = [
  {
    id: 'dashboard.global_chat',
    surface: 'page',
    pathname: '/dashboard/global-chat',
    match: 'prefix',
    requirement: 'feature',
    feature: 'global_chat',
    labels: ['AUTH', 'PRO', 'PREMIUM', 'AI', 'CACHE_SENSITIVE'],
    description: 'Global Chat cross-document assistant.',
    noStore: true,
  },
  {
    id: 'dashboard.predictions',
    surface: 'page',
    pathname: '/dashboard/predictions',
    match: 'prefix',
    requirement: 'feature',
    feature: 'exam_predictions',
    labels: ['AUTH', 'PRO', 'PREMIUM', 'AI', 'CACHE_SENSITIVE'],
    description: 'Exam prediction engine.',
    noStore: true,
  },
  {
    id: 'dashboard.practice',
    surface: 'page',
    pathname: '/dashboard/practice',
    match: 'prefix',
    requirement: 'feature',
    feature: 'practice_exam_generation',
    labels: ['AUTH', 'PRO', 'PREMIUM', 'AI', 'CACHE_SENSITIVE'],
    description: 'Practice exam generator and attempts.',
    noStore: true,
  },
  {
    id: 'dashboard.knowledge',
    surface: 'page',
    pathname: '/dashboard/knowledge',
    match: 'prefix',
    requirement: 'feature',
    feature: 'knowledge_generation',
    labels: ['AUTH', 'AI', 'CACHE_SENSITIVE'],
    description: 'Document intelligence and knowledge generation.',
    noStore: true,
  },
  {
    id: 'dashboard.subscription',
    surface: 'page',
    pathname: '/dashboard/settings/subscription',
    match: 'prefix',
    requirement: 'auth',
    labels: ['AUTH', 'BILLING', 'CACHE_SENSITIVE'],
    description: 'Subscription and billing management.',
    noStore: true,
  },
  {
    id: 'dashboard.authenticated',
    surface: 'page',
    pathname: '/dashboard',
    match: 'prefix',
    requirement: 'auth',
    labels: ['AUTH', 'CACHE_SENSITIVE'],
    description: 'Authenticated dashboard shell and account data.',
    noStore: true,
  },
  {
    id: 'conex.admin',
    surface: 'page',
    pathname: '/conex',
    match: 'prefix',
    requirement: 'admin',
    labels: ['AUTH', 'ADMIN', 'STAFF', 'INTERNAL', 'CACHE_SENSITIVE'],
    description: 'Conex admin console.',
    noStore: true,
  },
];

export const PROTECTED_API_RULES: readonly AccessRule[] = [
  {
    id: 'api.admin',
    surface: 'api',
    pathname: '/api/admin',
    match: 'prefix',
    requirement: 'admin',
    labels: ['AUTH', 'ADMIN', 'STAFF', 'INTERNAL', 'CACHE_SENSITIVE'],
    description: 'Admin-only API namespace.',
    noStore: true,
  },
  {
    id: 'api.conex_users',
    surface: 'api',
    pathname: '/conex/users',
    match: 'prefix',
    requirement: 'admin',
    labels: ['AUTH', 'ADMIN', 'STAFF', 'INTERNAL', 'CACHE_SENSITIVE'],
    description: 'Conex user-management route handler.',
    noStore: true,
  },
  {
    id: 'api.vps_ticket',
    surface: 'api',
    pathname: '/api/au/vps-ticket',
    match: 'exact',
    requirement: 'auth',
    labels: ['AUTH', 'AI', 'CACHE_SENSITIVE'],
    description: 'Short-lived VPS ticket minting endpoint.',
    noStore: true,
  },
  {
    id: 'api.document_upload',
    surface: 'api',
    pathname: '/api/au/document-upload',
    match: 'exact',
    requirement: 'feature',
    feature: 'document_upload',
    labels: ['AUTH', 'UPLOAD', 'CACHE_SENSITIVE'],
    description: 'Document upload initiation and completion.',
    noStore: true,
  },
  {
    id: 'api.practice_attempts',
    surface: 'api',
    pathname: '/api/au/practice-attempts',
    match: 'exact',
    requirement: 'feature',
    feature: 'practice_exam_generation',
    labels: ['AUTH', 'PRO', 'PREMIUM', 'AI', 'CACHE_SENSITIVE'],
    description: 'Practice exam attempt persistence.',
    noStore: true,
  },
  {
    id: 'api.feature_output',
    surface: 'api',
    pathname: '/api/feature-output',
    match: 'exact',
    requirement: 'auth',
    labels: ['AUTH', 'AI', 'CACHE_SENSITIVE'],
    description: 'Saved AI feature-output reads.',
    noStore: true,
  },
  {
    id: 'api.au_documents',
    surface: 'api',
    pathname: '/api/au/documents',
    match: 'prefix',
    requirement: 'auth',
    labels: ['AUTH', 'UPLOAD', 'CACHE_SENSITIVE'],
    description: 'Owned document API routes.',
    noStore: true,
  },
  {
    id: 'api.au_preferences',
    surface: 'api',
    pathname: '/api/au/preferences',
    match: 'prefix',
    requirement: 'auth',
    labels: ['AUTH', 'CACHE_SENSITIVE'],
    description: 'Authenticated AU preferences.',
    noStore: true,
  },
  {
    id: 'api.chat_history',
    surface: 'api',
    pathname: '/api/chat/history',
    match: 'exact',
    requirement: 'auth',
    labels: ['AUTH', 'AI', 'CACHE_SENSITIVE'],
    description: 'Authenticated chat history.',
    noStore: true,
  },
  {
    id: 'api.account',
    surface: 'api',
    pathname: '/api/account',
    match: 'prefix',
    requirement: 'auth',
    labels: ['AUTH', 'CACHE_SENSITIVE'],
    description: 'Authenticated account snapshot/effective/delete endpoints.',
    noStore: true,
  },
  {
    id: 'api.entitlements',
    surface: 'api',
    pathname: '/api/entitlements',
    match: 'prefix',
    requirement: 'auth',
    labels: ['AUTH', 'BILLING', 'CACHE_SENSITIVE'],
    description: 'Effective entitlement reads.',
    noStore: true,
  },
  {
    id: 'api.limits',
    surface: 'api',
    pathname: '/api/limits',
    match: 'prefix',
    requirement: 'auth',
    labels: ['AUTH', 'BILLING', 'CACHE_SENSITIVE'],
    description: 'Effective limit reads.',
    noStore: true,
  },
  {
    id: 'api.billing.cancel',
    surface: 'api',
    pathname: '/api/billing/cancel',
    match: 'exact',
    requirement: 'auth',
    labels: ['AUTH', 'BILLING', 'CACHE_SENSITIVE'],
    description: 'Subscription cancellation.',
    noStore: true,
  },
  {
    id: 'api.billing.checkout',
    surface: 'api',
    pathname: '/api/billing/checkout',
    match: 'exact',
    requirement: 'auth',
    labels: ['AUTH', 'BILLING', 'CACHE_SENSITIVE'],
    description: 'Billing checkout creation.',
    noStore: true,
  },
  {
    id: 'api.billing.reconcile',
    surface: 'api',
    pathname: '/api/billing/reconcile',
    match: 'exact',
    requirement: 'auth',
    labels: ['AUTH', 'BILLING', 'CACHE_SENSITIVE'],
    description: 'Billing reconciliation.',
    noStore: true,
  },
  {
    id: 'api.billing.resubscribe',
    surface: 'api',
    pathname: '/api/billing/resubscribe',
    match: 'exact',
    requirement: 'auth',
    labels: ['AUTH', 'BILLING', 'CACHE_SENSITIVE'],
    description: 'Subscription resubscribe.',
    noStore: true,
  },
  {
    id: 'api.billing.status',
    surface: 'api',
    pathname: '/api/billing/status',
    match: 'exact',
    requirement: 'auth',
    labels: ['AUTH', 'BILLING', 'CACHE_SENSITIVE'],
    description: 'Billing status.',
    noStore: true,
  },
  {
    id: 'api.payments.initialize',
    surface: 'api',
    pathname: '/api/payments/initialize',
    match: 'exact',
    requirement: 'auth',
    labels: ['AUTH', 'BILLING', 'CACHE_SENSITIVE'],
    description: 'Payment initialization.',
    noStore: true,
  },
  {
    id: 'api.payments.verify',
    surface: 'api',
    pathname: '/api/payments/verify',
    match: 'exact',
    requirement: 'auth',
    labels: ['AUTH', 'BILLING', 'CACHE_SENSITIVE'],
    description: 'Payment verification.',
    noStore: true,
  },
];

export const PREMIUM_FEATURE_KEYS = TIER_FEATURE_POLICIES
  .filter((feature) => !feature.allowedTiers.includes('FREE'))
  .map((feature) => feature.key);

export const PROTECTED_ROUTE_INVENTORY = Object.freeze({
  pages: PROTECTED_PAGE_RULES,
  apis: PROTECTED_API_RULES,
  premiumFeatures: PREMIUM_FEATURE_KEYS,
});

export const PWA_PROTECTED_CACHE_PREFIXES = [
  '/conex',
  '/dashboard/global-chat',
  '/dashboard/knowledge',
  '/dashboard/predictions',
  '/dashboard/practice',
  '/dashboard/settings/subscription',
  '/api/account',
  '/api/admin',
  '/api/au',
  '/api/billing',
  '/api/chat',
  '/api/entitlements',
  '/api/feature-output',
  '/api/feedback',
  '/api/limits',
  '/api/payments',
] as const;

const FEATURE_OUTPUT_MAP = {
  knowledge_hub: 'knowledge_generation',
  exam_prediction: 'exam_predictions',
  practice_exam_generation: 'practice_exam_generation',
} satisfies Record<string, TierFeatureKey>;

const VPS_TICKET_FEATURE_MAP = {
  chat: 'au_chat',
  'au-chat': 'au_chat',
  au_chat: 'au_chat',
  'global-chat': 'global_chat',
  global_chat: 'global_chat',
  'generate-knowledge': 'knowledge_generation',
  knowledge: 'knowledge_generation',
  knowledge_hub: 'knowledge_generation',
  knowledge_generation: 'knowledge_generation',
  'exam-generator': 'practice_exam_generation',
  'generate-practice-exam': 'practice_exam_generation',
  practice: 'practice_exam_generation',
  practice_exam_generation: 'practice_exam_generation',
  'prediction-engine': 'exam_predictions',
  'generate-exam-predictions': 'exam_predictions',
  exam_prediction: 'exam_predictions',
  exam_predictions: 'exam_predictions',
  'generate-prompt-starters': 'prompt_starters',
  prompt_starters: 'prompt_starters',
  'document-upload': 'document_upload',
  document_upload: 'document_upload',
} satisfies Record<string, TierFeatureKey>;

function normalizeToken(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function routeMatches(rule: AccessRule, pathname: string): boolean {
  const normalized = pathname || '/';
  if (rule.match === 'exact') return normalized === rule.pathname;
  return normalized === rule.pathname || normalized.startsWith(`${rule.pathname}/`);
}

function findAccessRule(rules: readonly AccessRule[], pathname: string): AccessRule | null {
  const matches = rules.filter((rule) => routeMatches(rule, pathname));
  matches.sort((a, b) => b.pathname.length - a.pathname.length);
  return matches[0] || null;
}

function parseTimestampMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function isPastTimestamp(value: string | null | undefined, nowMs = Date.now()): boolean {
  const ms = parseTimestampMs(value);
  return ms !== null && ms <= nowMs;
}

export function findPageAccessRule(pathname: string): AccessRule | null {
  return findAccessRule(PROTECTED_PAGE_RULES, pathname);
}

export function findApiAccessRule(pathname: string): AccessRule | null {
  return findAccessRule(PROTECTED_API_RULES, pathname);
}

export function featureFromFeatureOutput(value: unknown): TierFeatureKey | null {
  return FEATURE_OUTPUT_MAP[normalizeToken(value) as keyof typeof FEATURE_OUTPUT_MAP] ?? null;
}

export function featureFromVpsTicketRequest(value: unknown): TierFeatureKey | null {
  return VPS_TICKET_FEATURE_MAP[normalizeToken(value) as keyof typeof VPS_TICKET_FEATURE_MAP] ?? null;
}

export function normalizeAccessPlan(subject: EntitlementSubject | null | undefined): TierId {
  if (!subject?.userId) return 'FREE';
  const adminOverridePlan = normalizeAdminOverridePlan(subject.adminOverridePlan);
  if (adminOverridePlan) return isPaidAdminOverridePlan(adminOverridePlan) ? 'PRO' : 'FREE';
  const plan = normalizeToken(subject.plan);
  const profileTier = normalizeToken(subject.profileTier);

  if (subject.adminOverride || plan === 'admin' || profileTier === 'admin') return 'PRO';
  if (isPastTimestamp(subject.entitlementEndsAt)) return 'FREE';
  if (plan === 'promo_pro' || profileTier === 'promo_pro') {
    const promoEndsAt = subject.promoEndsAtUtc || subject.entitlementEndsAt || null;
    if (subject.promoActive === true || (promoEndsAt !== null && !isPastTimestamp(promoEndsAt))) {
      return 'PROMO_PRO';
    }
    return 'FREE';
  }
  if (
    subject.hasPro ||
    plan === 'pro' ||
    plan === 'premium' ||
    plan === 'paid' ||
    plan === 'weekly' ||
    plan === 'monthly' ||
    profileTier === 'pro' ||
    profileTier === 'premium' ||
    profileTier === 'weekly' ||
    profileTier === 'monthly' ||
    profileTier === 'paid'
  ) {
    return 'PRO';
  }

  return 'FREE';
}

export function hasActivePaidAccess(subject: EntitlementSubject | null | undefined): boolean {
  if (!subject?.userId) return false;
  if (subject.suspended) return false;
  const adminOverridePlan = normalizeAdminOverridePlan(subject.adminOverridePlan);
  if (adminOverridePlan) return isPaidAdminOverridePlan(adminOverridePlan);
  if (subject.adminOverride || normalizeToken(subject.plan) === 'admin' || normalizeToken(subject.profileTier) === 'admin') {
    return true;
  }
  return normalizeAccessPlan(subject) !== 'FREE';
}

export function isAccessEntitlementExpired(subject: EntitlementSubject | null | undefined): boolean {
  if (!subject?.userId) return false;
  return isPastTimestamp(subject.entitlementEndsAt);
}

export function isAdminSubject(subject: EntitlementSubject | null | undefined): boolean {
  if (!subject?.userId) return false;
  return Boolean(subject.adminOverride);
}

export function evaluateAccess(
  subject: EntitlementSubject | null | undefined,
  rule: Pick<AccessRule, 'id' | 'requirement' | 'feature' | 'labels'>,
): AccessDecision {
  const plan = normalizeAccessPlan(subject);
  const labels = rule.labels ?? [];
  const hasAdminTestingOverride = Boolean(normalizeAdminOverridePlan(subject?.adminOverridePlan));
  const base = {
    requirement: rule.requirement,
    feature: rule.feature,
    routeId: rule.id,
    plan,
    labels,
  };

  if (!subject?.userId) {
    return {
      ...base,
      allowed: false,
      status: 401,
      code: 'UNAUTHORIZED',
      reason: 'Authentication required.',
    };
  }

  if (subject.suspended) {
    return {
      ...base,
      allowed: false,
      status: 403,
      code: 'ACCOUNT_SUSPENDED',
      reason: 'Account is suspended.',
    };
  }

  if (rule.requirement === 'auth') {
    return { ...base, allowed: true, status: 200, code: null, reason: null };
  }

  if (rule.requirement === 'admin') {
    if (isAdminSubject(subject)) {
      return { ...base, allowed: true, status: 200, code: null, reason: null };
    }
    return {
      ...base,
      allowed: false,
      status: 403,
      code: 'FORBIDDEN',
      reason: 'Admin access required.',
    };
  }

  if (rule.requirement === 'paid') {
    if (hasActivePaidAccess(subject)) {
      return { ...base, allowed: true, status: 200, code: null, reason: null };
    }
    return {
      ...base,
      allowed: false,
      status: 403,
      code: isAccessEntitlementExpired(subject) ? 'ENTITLEMENT_EXPIRED' : 'UPGRADE_REQUIRED',
      reason: isAccessEntitlementExpired(subject) ? 'Paid entitlement has expired.' : 'Paid access required.',
      upgradeUrl: '/pricing?source=paid_access',
    };
  }

  if (!rule.feature) {
    return {
      ...base,
      allowed: false,
      status: 403,
      code: 'FORBIDDEN',
      reason: 'Feature access rule is missing a feature key.',
    };
  }

  if ((!hasAdminTestingOverride && isAdminSubject(subject)) || isFeatureAllowedForTier(rule.feature, plan)) {
    return { ...base, allowed: true, status: 200, code: null, reason: null };
  }

  return {
    ...base,
    allowed: false,
    status: 403,
    code: isAccessEntitlementExpired(subject) ? 'ENTITLEMENT_EXPIRED' : 'UPGRADE_REQUIRED',
    reason: isAccessEntitlementExpired(subject) ? 'Feature entitlement has expired.' : 'Feature requires an active paid entitlement.',
    upgradeUrl: featureUpgradeHref(rule.feature),
  };
}

export function buildFeatureAccessRule(feature: TierFeatureKey): Pick<AccessRule, 'id' | 'requirement' | 'feature' | 'labels'> {
  const policy = TIER_FEATURE_POLICIES.find((entry) => entry.key === feature);
  const isPremium = policy ? !policy.allowedTiers.includes('FREE') : true;
  return {
    id: `feature.${feature}`,
    requirement: 'feature',
    feature,
    labels: isPremium
      ? ['AUTH', 'PRO', 'PREMIUM', 'AI', 'CACHE_SENSITIVE']
      : ['AUTH', 'AI', 'CACHE_SENSITIVE'],
  };
}
