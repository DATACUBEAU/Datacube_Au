import { test, expect } from '@playwright/test';

/**
 * E2E Validation for Auth Resilience and Generation Conflict Resolution
 * Covers:
 * 1. 401 Unauthorized responses do not create forced redirect loops
 * 2. 409 Conflict Handling (GENERATION_LOCKED)
 * 3. Admin Cache Reset (DELETE /api/admin/feature-output)
 */

test.describe('Auth and Generation Resilience Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Mock login or use session storage if available
    await page.goto('/login');
    await page.fill('input[name="email"]', 'test@datacube-au.vercel.app');
    await page.fill('input[name="password"]', 'password123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL('/dashboard');
  });

  test('should stay on the current page when a passive 401 occurs', async ({ page }) => {
    await page.goto('/dashboard/chat');
    
    // Mock a 401 response for the documents list or chat history
    await page.route('**/api/proxy/**', async route => {
      await route.fulfill({
        status: 401,
        headers: {
          'x-request-id': 'test-401-req',
          'x-correlation-id': 'test-401-corr',
        },
        body: JSON.stringify({ error: 'unauthorized', reason: 'invalid_token' }),
      });
    });

    await page.waitForTimeout(1500);
    await expect(page).toHaveURL(/\/dashboard\/chat/);
  });

  test('should handle 409 Conflict and allow admin to clear cache', async ({ page }) => {
    const docId = 'test-doc-uuid';
    await page.goto(`/dashboard/knowledge?docId=${docId}`);

    // 1. Mock a 409 Conflict (failed previous generation)
    await page.route('**/api/proxy/generate-knowledge**', async route => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            code: 'FEATURE_OUTPUT_FAILED',
            message: 'Generation previously failed',
            correlation_id: 'corr-123',
            doc_version_id: 'v1'
          }),
        });
      } else {
        await route.continue();
      }
    });

    await page.click('button:has-text("Generate Knowledge")');

    // 2. Assert toast appears with "Ask Admin / Clear" button
    const toast = page.locator('div[role="status"]');
    await expect(toast).toContainText('Generation locked');
    const clearButton = toast.locator('button:has-text("Ask Admin / Clear")');
    await expect(clearButton).toBeVisible();

    // 3. Mock the admin clear cache endpoint
    await page.route('**/api/admin/feature-output', async route => {
      if (route.request().method() === 'DELETE') {
        await route.fulfill({
          status: 200,
          body: JSON.stringify({ ok: true, cleared: 1 }),
        });
      } else {
        await route.continue();
      }
    });

    // 4. Click clear and verify success toast
    await clearButton.click();
    await expect(page.locator('div[role="status"]')).toContainText('Cache cleared');

    // 5. Mock successful generation after clear
    await page.route('**/api/proxy/generate-knowledge**', async route => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 200,
          body: JSON.stringify({ status: 'running', job_id: 'job-123' }),
        });
      } else {
        await route.continue();
      }
    });

    await page.click('button:has-text("Generate Knowledge")');
    await expect(page.locator('div[role="status"]')).toContainText('Generating in progress');
  });
});
