import { expect, test } from '@playwright/test';

test.describe('Network health and offline resilience', () => {
  test('returns ok from /api/health', async ({ request }) => {
    const response = await request.get('/api/health', { failOnStatusCode: false });
    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.ok).toBe(true);
  });

  test('shows offline indicator after consecutive health failures', async ({ page }) => {
    await page.route('**/api/health', async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false }),
      });
    });

    await page.goto('/');
    await expect(page.getByText('You are offline')).toBeVisible({ timeout: 8000 });
  });
});
