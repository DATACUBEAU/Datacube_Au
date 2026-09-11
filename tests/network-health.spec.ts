import { expect, test } from '@playwright/test';

test.describe('Network health and offline resilience', () => {
  test('returns ok from /api/health', async ({ request }) => {
    const response = await request.get('/api/health', { failOnStatusCode: false });
    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.ok).toBe(true);
  });

  test('keeps liveness separate from datastore readiness', async ({ request }) => {
    const response = await request.get('/api/health/ready', { failOnStatusCode: false });
    expect(response.status()).toBe(503);
    expect(response.headers()['cache-control']).toContain('no-store');

    const data = await response.json();
    expect(data.ok).toBe(false);
    expect(data.status).toBe('degraded');
    expect(['unavailable', 'timeout']).toContain(data.checks?.database);
    expect(typeof data.request_id).toBe('string');
    expect(JSON.stringify(data)).not.toContain('ci-build-placeholder-service-role-key');
    expect(JSON.stringify(data)).not.toContain('ci-build.invalid');
  });

  test('shows offline indicator when the browser is actually offline', async ({ page }) => {
    await page.goto('/');
    await page.context().setOffline(true);
    await expect(page.getByText('You are offline')).toBeVisible({ timeout: 8000 });
  });

  test('keeps the app out of hard offline mode when navigator is online but health checks degrade', async ({ page }) => {
    await page.route('**/api/health', async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false }),
      });
    });

    await page.goto('/');
    await expect(page.getByText('You are offline')).toHaveCount(0);
  });

  test('clears the offline indicator after connectivity returns and health checks recover', async ({ page }) => {
    await page.goto('/');

    await page.context().setOffline(true);
    await expect(page.getByText('You are offline')).toBeVisible({ timeout: 8000 });

    await page.context().setOffline(false);
    await expect(page.getByText('You are offline')).toHaveCount(0, { timeout: 15000 });
  });
});
