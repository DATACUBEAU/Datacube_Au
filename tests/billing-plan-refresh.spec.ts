import { expect, test } from '@playwright/test';

test.describe('Billing plan refresh stability', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/billing-refresh');
  });

  test('keeps the paid plan after a successful renewal response', async ({ page }) => {
    await page.getByTestId('scenario-successful-renewal').click();

    await expect(page.getByTestId('displayed-plan')).toHaveText('pro');
    await expect(page.getByTestId('plan-checksum')).toHaveText('plan:pro-monthly:v2');
    await expect(page.getByTestId('event-log')).toContainText('applied:renewal-success');
  });

  test('drops immediately to free after a final renewal failure', async ({ page }) => {
    await page.getByTestId('scenario-hard-decline').click();

    await expect(page.getByTestId('displayed-plan')).toHaveText('free');
    await expect(page.getByTestId('plan-checksum')).toHaveText('plan:free:final-failure:v4');
    await expect(page.getByTestId('event-log')).toContainText('applied:final-failure');
  });

  test('preserves the last authoritative plan when the refresh times out', async ({ page }) => {
    await page.getByTestId('scenario-network-timeout').click();

    await expect(page.getByTestId('displayed-plan')).toHaveText('pro');
    await expect(page.getByTestId('plan-checksum')).toHaveText('plan:pro-monthly:v2');
    await expect(page.getByTestId('event-log')).toContainText('timeout:status');
  });

  test('ignores stale overlapping refresh responses', async ({ page }) => {
    await page.getByTestId('scenario-concurrent-refresh').click();

    await expect(page.getByTestId('displayed-plan')).toHaveText('pro');
    await expect(page.getByTestId('active-plan-key')).toHaveText('pro_weekly');
    await expect(page.getByTestId('plan-checksum')).toHaveText('plan:pro-weekly:v3');
    await expect(page.getByTestId('event-log')).toContainText('applied:authoritative-refresh');
    await expect(page.getByTestId('event-log')).toContainText('ignored:stale-refresh');
  });
});
