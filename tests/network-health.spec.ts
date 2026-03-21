import { expect, test } from '@playwright/test';

test.describe('Network health and offline resilience', () => {
  test('returns ok from /api/health', async ({ request }) => {
    const response = await request.get('/api/health', { failOnStatusCode: false });
    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.ok).toBe(true);
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
});
