import { expect, test } from '@playwright/test';

test.describe('Pricing plan expiration copy', () => {
  test('renders the 14-day and 30-day document expiration windows', async ({ page }) => {
    test.setTimeout(60_000);

    await page.goto('/pricing', { waitUntil: 'domcontentloaded' });

    const fourteenDayExpiration = page.getByText('Document expiration: 14 days');
    const thirtyDayExpiration = page.getByText('Document expiration: 30 days');

    await expect(fourteenDayExpiration.first()).toBeVisible();
    await expect(thirtyDayExpiration.first()).toBeVisible();
  });
});
