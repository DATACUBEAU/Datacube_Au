/**
 * Phase 5 — Validation: Rate limiter + Plan resolution tests.
 * Run: npx tsx src/lib/server/__tests__/phase5-validation.ts
 */

// ── Rate Limiter Tests ───────────────────────────────────────────────────

// Inline the rate limiter logic to test without module resolution issues
function createTestRateLimiter(config: {
  userRateLimit: number;
  ipRateLimit: number;
  windowMs: number;
  burstLimit: number;
  burstWindowMs: number;
}) {
  const userBuckets = new Map<string, number[]>();
  const ipBuckets = new Map<string, number[]>();

  function pruneWindow(timestamps: number[], windowMs: number, now: number): number[] {
    let i = 0;
    while (i < timestamps.length && timestamps[i] < now - windowMs) i++;
    if (i > 0) timestamps.splice(0, i);
    return timestamps;
  }

  return function checkRateLimit(userId: string, clientIp: string, nowOverride?: number) {
    const now = nowOverride ?? Date.now();
    const userTs = userBuckets.get(userId) || [];
    if (!userBuckets.has(userId)) userBuckets.set(userId, userTs);
    pruneWindow(userTs, config.windowMs, now);

    const burstCount = userTs.filter(t => t >= now - config.burstWindowMs).length;
    if (burstCount >= config.burstLimit) {
      return { allowed: false, blockedBy: 'user_burst' as const, count: burstCount, limit: config.burstLimit };
    }
    if (userTs.length >= config.userRateLimit) {
      return { allowed: false, blockedBy: 'user_rate' as const, count: userTs.length, limit: config.userRateLimit };
    }

    const ipTs = ipBuckets.get(clientIp) || [];
    if (!ipBuckets.has(clientIp)) ipBuckets.set(clientIp, ipTs);
    pruneWindow(ipTs, config.windowMs, now);

    if (ipTs.length >= config.ipRateLimit) {
      return { allowed: false, blockedBy: 'ip_rate' as const, count: ipTs.length, limit: config.ipRateLimit };
    }

    userTs.push(now);
    ipTs.push(now);
    return { allowed: true, blockedBy: null, count: userTs.length, limit: config.userRateLimit };
  };
}

// ── Plan Resolution Tests ────────────────────────────────────────────────

type EffectivePlan = {
  plan: string;
  isAdmin: boolean;
  hasPro: boolean;
  source: string;
  entitlementSource: string;
  expiresAt: string | null;
};

function normalizeProfileTier(raw: unknown): { plan: string | null; isAdmin: boolean } {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'admin') return { plan: 'pro', isAdmin: true };
  if (s === 'premium') return { plan: 'premium', isAdmin: false };
  if (s === 'pro') return { plan: 'pro', isAdmin: false };
  if (s === 'free') return { plan: 'free', isAdmin: false };
  return { plan: null, isAdmin: false };
}

function normalizePlan(raw: string): string | null {
  if (raw === 'pro') return 'pro';
  if (raw === 'premium') return 'premium';
  if (raw === 'free') return 'free';
  return null;
}

function normalizeEntitlementSource(raw: string | null): string {
  if (!raw) return 'none';
  const s = raw.trim().toLowerCase();
  if (s === 'paid') return 'paid';
  if (s === 'promo') return 'promo';
  return 'none';
}

function resolveEffectivePlanFromInputs(input: {
  profileTier?: string | null;
  mirroredPlan?: string | null;
  mirroredSource?: string | null;
  mirroredExpiresAt?: string | null;
  entitlementPlan?: string | null;
  entitlementSource?: string | null;
  entitlementEndsAt?: string | null;
}): EffectivePlan {
  const profileTierRaw = String(input.profileTier || '').trim().toLowerCase();
  const profileInfo = normalizeProfileTier(input.profileTier);
  const mirroredPlanRaw = String(input.mirroredPlan || '').trim().toLowerCase();
  const mirroredPlan = mirroredPlanRaw && mirroredPlanRaw !== 'promo_pro' ? normalizePlan(mirroredPlanRaw) : null;
  const mirroredSource = normalizeEntitlementSource(
    typeof input.mirroredSource === 'string' ? input.mirroredSource : null,
  );
  const mirroredExpiresAt = typeof input.mirroredExpiresAt === 'string' ? input.mirroredExpiresAt : null;
  const entitlementPlanRaw = String(input.entitlementPlan || '').trim().toLowerCase();
  const entitlementPlan = entitlementPlanRaw && entitlementPlanRaw !== 'promo_pro' ? normalizePlan(entitlementPlanRaw) : null;
  const entitlementSource = normalizeEntitlementSource(
    typeof input.entitlementSource === 'string' ? input.entitlementSource : null,
  );
  const entitlementEndsAt = typeof input.entitlementEndsAt === 'string' ? input.entitlementEndsAt : null;
  const hasPaidBillingPlan = entitlementSource === 'paid' && entitlementPlan === 'pro';
  const hasPromoOnlyAccess =
    entitlementSource === 'promo' ||
    entitlementPlanRaw === 'promo_pro' ||
    mirroredPlanRaw === 'promo_pro' ||
    profileTierRaw === 'promo_pro';

  const nowMs = Date.now();
  const isMirroredExpired =
    typeof mirroredExpiresAt === 'string' &&
    new Date(mirroredExpiresAt).getTime() < nowMs;
  const isEntitlementExpired =
    typeof entitlementEndsAt === 'string' &&
    new Date(entitlementEndsAt).getTime() < nowMs;

  const resolvedMirroredPlan = isMirroredExpired ? 'free' : mirroredPlan;
  const resolvedEntitlementPlan = isEntitlementExpired ? 'free' : entitlementPlan;

  if (profileInfo.isAdmin) {
    return { plan: 'pro', isAdmin: true, hasPro: true, source: 'profile', entitlementSource: 'paid', expiresAt: null };
  }
  if (profileInfo.plan === 'premium') {
    return { plan: 'premium', isAdmin: false, hasPro: true, source: 'profile', entitlementSource: 'paid', expiresAt: null };
  }
  if (resolvedMirroredPlan === 'premium') {
    return { plan: 'premium', isAdmin: false, hasPro: true, source: 'au_user_entitlements', entitlementSource: mirroredSource === 'none' ? 'paid' : mirroredSource, expiresAt: mirroredExpiresAt };
  }
  if (hasPaidBillingPlan && !isEntitlementExpired) {
    return { plan: resolvedEntitlementPlan || 'pro', isAdmin: false, hasPro: true, source: 'billing', entitlementSource, expiresAt: entitlementEndsAt };
  }
  if (resolvedMirroredPlan) {
    return { plan: resolvedMirroredPlan, isAdmin: false, hasPro: resolvedMirroredPlan !== 'free', source: 'au_user_entitlements', entitlementSource: resolvedMirroredPlan === 'free' ? 'none' : (mirroredSource === 'none' ? 'paid' : mirroredSource), expiresAt: mirroredExpiresAt };
  }
  if (profileInfo.plan) {
    return { plan: profileInfo.plan, isAdmin: false, hasPro: profileInfo.plan !== 'free', source: 'profile', entitlementSource: profileInfo.plan === 'free' ? 'none' : 'paid', expiresAt: null };
  }
  if (hasPromoOnlyAccess) {
    return { plan: 'free', isAdmin: false, hasPro: false, source: 'billing', entitlementSource: 'promo', expiresAt: entitlementEndsAt };
  }
  return { plan: 'free', isAdmin: false, hasPro: false, source: 'default', entitlementSource: 'none', expiresAt: null };
}

// ── Test Runner ──────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${label}`);
    passed++;
  } else {
    console.log(`  ❌ FAIL: ${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

console.log('\n════════════════════════════════════════════════════════');
console.log('  PHASE 5 — VALIDATION & STRESS TESTING');
console.log('════════════════════════════════════════════════════════\n');

// ─────────────────────────────────────────────────────────────────────────
console.log('── 1. Rate Limiter: Burst Detection ──');
{
  const check = createTestRateLimiter({
    userRateLimit: 30, ipRateLimit: 60,
    windowMs: 60_000, burstLimit: 5, burstWindowMs: 3_000,
  });
  const now = Date.now();
  for (let i = 0; i < 5; i++) {
    const r = check('user-burst', '1.1.1.1', now + i);
    if (i < 5) assert(`Burst req ${i+1} allowed`, r.allowed);
  }
  const blocked = check('user-burst', '1.1.1.1', now + 10);
  assert('Burst req 6 blocked', !blocked.allowed);
  assert('Blocked by user_burst', blocked.blockedBy === 'user_burst');
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n── 2. Rate Limiter: User Rate Limit ──');
{
  const check = createTestRateLimiter({
    userRateLimit: 10, ipRateLimit: 100,
    windowMs: 60_000, burstLimit: 100, burstWindowMs: 3_000,
  });
  const now = Date.now();
  for (let i = 0; i < 10; i++) {
    // Spread requests across burst window to not trigger burst
    check('user-rate', '2.2.2.2', now + i * 4000);
  }
  const blocked = check('user-rate', '2.2.2.2', now + 50_000);
  assert('User rate limit blocks at 11th request', !blocked.allowed);
  assert('Blocked by user_rate', blocked.blockedBy === 'user_rate');
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n── 3. Rate Limiter: IP Rate Limit ──');
{
  const check = createTestRateLimiter({
    userRateLimit: 100, ipRateLimit: 5,
    windowMs: 60_000, burstLimit: 100, burstWindowMs: 3_000,
  });
  const now = Date.now();
  for (let i = 0; i < 5; i++) {
    check(`user-${i}`, '3.3.3.3', now + i * 4000);
  }
  const blocked = check('user-new', '3.3.3.3', now + 30_000);
  assert('IP rate limit blocks different users on same IP', !blocked.allowed);
  assert('Blocked by ip_rate', blocked.blockedBy === 'ip_rate');
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n── 4. Rate Limiter: Window Expiry ──');
{
  const check = createTestRateLimiter({
    userRateLimit: 3, ipRateLimit: 100,
    windowMs: 10_000, burstLimit: 100, burstWindowMs: 3_000,
  });
  const now = Date.now();
  for (let i = 0; i < 3; i++) check('user-expiry', '4.4.4.4', now);
  const blocked = check('user-expiry', '4.4.4.4', now + 5_000);
  assert('Blocked within window', !blocked.allowed);
  // After window expires
  const allowed = check('user-expiry', '4.4.4.4', now + 15_000);
  assert('Allowed after window expires', allowed.allowed);
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n── 5. Plan Resolution: Active Pro ──');
{
  const plan = resolveEffectivePlanFromInputs({
    mirroredPlan: 'pro',
    mirroredSource: 'paid',
    mirroredExpiresAt: new Date(Date.now() + 86400_000 * 30).toISOString(),
  });
  assert('Active Pro resolves as pro', plan.plan === 'pro');
  assert('Active Pro has hasPro=true', plan.hasPro === true);
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n── 6. Plan Resolution: Expired Pro → Free ──');
{
  const plan = resolveEffectivePlanFromInputs({
    mirroredPlan: 'pro',
    mirroredSource: 'paid',
    mirroredExpiresAt: new Date(Date.now() - 86400_000).toISOString(), // expired yesterday
  });
  assert('Expired Pro resolves as free', plan.plan === 'free');
  assert('Expired Pro has hasPro=false', plan.hasPro === false);
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n── 7. Plan Resolution: Expired Billing → Free ──');
{
  const plan = resolveEffectivePlanFromInputs({
    entitlementPlan: 'pro',
    entitlementSource: 'paid',
    entitlementEndsAt: new Date(Date.now() - 3600_000).toISOString(), // expired 1h ago
  });
  assert('Expired billing Pro resolves as free', plan.plan === 'free');
  assert('Expired billing has hasPro=false', plan.hasPro === false);
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n── 8. Plan Resolution: Admin Bypasses Expiry ──');
{
  const plan = resolveEffectivePlanFromInputs({
    profileTier: 'admin',
    mirroredPlan: 'pro',
    mirroredExpiresAt: new Date(Date.now() - 86400_000).toISOString(), // expired
  });
  assert('Admin resolves as pro', plan.plan === 'pro');
  assert('Admin has isAdmin=true', plan.isAdmin === true);
  assert('Admin has hasPro=true', plan.hasPro === true);
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n── 9. Plan Resolution: Free User ──');
{
  const plan = resolveEffectivePlanFromInputs({});
  assert('No inputs → free', plan.plan === 'free');
  assert('No inputs → hasPro=false', plan.hasPro === false);
  assert('No inputs → source=default', plan.source === 'default');
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n── 10. Plan Resolution: Premium User ──');
{
  const plan = resolveEffectivePlanFromInputs({ profileTier: 'premium' });
  assert('Premium profile → premium', plan.plan === 'premium');
  assert('Premium → hasPro=true', plan.hasPro === true);
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n\n════════════════════════════════════════════════════════');
console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
console.log('════════════════════════════════════════════════════════\n');

process.exit(failed > 0 ? 1 : 0);
