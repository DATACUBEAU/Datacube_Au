/**
 * Premium Nav: Locked State — Playwright E2E Tests
 *
 * Verifies the discovery UX for free users and confirms that:
 * 1. Locked items are always rendered (never hidden) for free users.
 * 2. Direct URL navigation to premium routes remains blocked by middleware.
 * 3. Clicking a locked item opens the upgrade modal with correct copy.
 * 4. Pro users see unlocked, navigable items with no lock badges.
 *
 * IMPORTANT: These tests assert *presentation* only. All server-side
 * authorization, middleware, entitlement resolution, and VPS ticket
 * enforcement remain completely untouched and are assumed to be verified
 * by the existing auth and billing test suites.
 */

import { test, expect, type Page } from '@playwright/test';

// ── Shared feature definitions ─────────────────────────────────────────────

const PREMIUM_FEATURES = [
  { key: 'global_chat',              testId: 'locked-nav-global_chat',              label: 'Global Chat',  url: '/dashboard/global-chat' },
  { key: 'knowledge_hub',            testId: 'locked-nav-knowledge_hub',            label: 'Knowledge',    url: '/dashboard/knowledge' },
  { key: 'exam_prediction',          testId: 'locked-nav-exam_prediction',          label: 'Predictions',  url: '/dashboard/predictions' },
  { key: 'practice_exam_generation', testId: 'locked-nav-practice_exam_generation', label: 'Practice',     url: '/dashboard/practice' },
];

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Injects a fake session cookie and mocks the entitlements API so the
 * dashboard renders without a real Supabase session.
 */
async function mockSession(page: Page, plan: 'free' | 'pro') {
  const hasPro = plan === 'pro';

  // Block real API calls that would fail without credentials
  await page.route('**/api/feature-flags', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows: [] }) })
  );
  await page.route('**/api/au/account-snapshot', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        plan: hasPro ? 'pro' : 'free',
        hasPro,
        entitlementSource: hasPro ? 'paid' : 'none',
        promoActive: false,
        asOf: new Date().toISOString(),
      }),
    })
  );
  await page.route('**/api/au/entitlements**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        plan: hasPro ? 'pro' : 'free',
        hasPro,
        entitlementSource: hasPro ? 'paid' : 'none',
        promoActive: false,
      }),
    })
  );
  // Suppress unread count calls
  await page.route('**/api/messages/unread**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ count: 0 }) })
  );
}

// ── Test Suite ────────────────────────────────────────────────────────────

test.describe('Premium nav — locked state UX', () => {

  // ── 1. Free users see locked items ──────────────────────────────────────
  test.describe('Free user visibility', () => {
    PREMIUM_FEATURES.forEach(({ key, testId, label }) => {
      test(`renders "${label}" nav item in locked state for free users`, async ({ page }) => {
        await mockSession(page, 'free');
        await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });

        // The item must be present in the DOM (never hidden)
        const lockedItem = page.getByTestId(testId);
        await expect(lockedItem).toBeVisible({ timeout: 10_000 });

        // Must carry a "Pro" badge (lock icon text or aria-label)
        const badge = lockedItem.locator('[aria-label*="Pro feature"]');
        await expect(badge).toBeVisible();

        // Must NOT be a navigable <a> tag
        const link = lockedItem.locator('a');
        await expect(link).toHaveCount(0);
      });
    });
  });

  // ── 2. Direct URL access remains server-blocked ─────────────────────────
  test.describe('Direct URL blocking (server middleware)', () => {
    const protectedRoutes = PREMIUM_FEATURES.map((f) => f.url);

    protectedRoutes.forEach((url) => {
      test(`direct navigation to "${url}" without session is blocked`, async ({ request }) => {
        // No cookies/session — middleware should redirect or return 4xx
        const response = await request.get(url, {
          failOnStatusCode: false,
          maxRedirects: 0,
        });

        // Acceptable: redirect to login OR 401/403 — NOT 200 with page content
        const isRedirect = [301, 302, 303, 307, 308].includes(response.status());
        const isBlocked = [401, 403].includes(response.status());

        expect(isRedirect || isBlocked).toBeTruthy();
      });
    });
  });

  // ── 3. Upgrade modal opens on locked click ───────────────────────────────
  test.describe('Upgrade modal on locked click', () => {
    PREMIUM_FEATURES.forEach(({ key, testId, label }) => {
      test(`clicking locked "${label}" opens upgrade modal with feature copy`, async ({ page }) => {
        await mockSession(page, 'free');
        await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });

        const lockedItem = page.getByTestId(testId);
        await expect(lockedItem).toBeVisible({ timeout: 10_000 });

        await lockedItem.click();

        // Upgrade modal must appear
        const modal = page.getByTestId('upgrade-modal');
        await expect(modal).toBeVisible({ timeout: 5_000 });

        // Title should reference the specific feature (not generic)
        const title = page.getByTestId('upgrade-modal-title');
        await expect(title).toBeVisible();
        const titleText = await title.textContent();
        expect(titleText).toBeTruthy();
        // The title should not just say "Upgrade to Pro" — it should be feature-specific
        expect(titleText).not.toBe('Upgrade to Pro');

        // Benefits list must contain at least one item
        const benefits = page.getByTestId('upgrade-modal-benefits');
        await expect(benefits.locator('div')).toHaveCount({ minimum: 1 } as any);
      });
    });
  });

  // ── 4. Pro users get unlocked items ─────────────────────────────────────
  test.describe('Pro user navigation', () => {
    PREMIUM_FEATURES.forEach(({ key, testId, label }) => {
      test(`"${label}" is a navigable link (not locked) for pro users`, async ({ page }) => {
        await mockSession(page, 'pro');
        await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });

        // The locked testId should NOT be present for pro users
        const lockedItem = page.getByTestId(testId);
        await expect(lockedItem).toHaveCount(0, { timeout: 8_000 });

        // A regular navigable link for the label should exist
        const navLink = page.locator(`nav a, [data-sidebar="menu-button"] a`).filter({ hasText: label });
        await expect(navLink.first()).toBeVisible({ timeout: 8_000 });
      });
    });
  });
});
