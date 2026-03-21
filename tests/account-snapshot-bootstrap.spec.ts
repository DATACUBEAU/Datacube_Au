import { expect, test } from '@playwright/test';

test.describe('Account snapshot bootstrap stability', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/account-snapshot');
  });

  test('refresh bootstrap keeps a cached Pro plan instead of falling back to free', async ({ page }) => {
    await page.getByTestId('scenario-refresh-pro').click();

    await expect(page.getByTestId('displayed-plan')).toHaveText('pro');
    await expect(page.getByTestId('using-cache')).toHaveText('true');
    await expect(page.getByTestId('event-log')).not.toContainText('free');
  });

  test('offline signed-in Pro state stays Pro from the last validated snapshot', async ({ page }) => {
    await page.getByTestId('scenario-offline-pro').click();

    await expect(page.getByTestId('displayed-plan')).toHaveText('pro');
    await expect(page.getByTestId('snapshot-state')).toHaveText('offline-cached-pro');
    await expect(page.getByTestId('using-cache')).toHaveText('true');
  });

  test('reconnect revalidates successfully without downgrading a valid Pro plan', async ({ page }) => {
    await page.getByTestId('scenario-reconnect-success').click();

    await expect(page.getByTestId('displayed-plan')).toHaveText('pro');
    await expect(page.getByTestId('snapshot-state')).toHaveText('revalidated-pro');
    await expect(page.getByTestId('using-cache')).toHaveText('false');
  });

  test('backend truth is the only source allowed to downgrade to free', async ({ page }) => {
    await page.getByTestId('scenario-backend-downgrade').click();

    await expect(page.getByTestId('displayed-plan')).toHaveText('free');
    await expect(page.getByTestId('snapshot-state')).toHaveText('backend-downgrade');
    await expect(page.getByTestId('event-log')).toContainText('server:backend-downgrade:free');
  });

  test('fetch failures preserve the last validated Pro snapshot', async ({ page }) => {
    await page.getByTestId('scenario-fetch-failure').click();

    await expect(page.getByTestId('displayed-plan')).toHaveText('pro');
    await expect(page.getByTestId('snapshot-state')).toHaveText('fetch-failure-preserved');
    await expect(page.getByTestId('using-cache')).toHaveText('true');
  });

  test('cache misses stay unknown instead of silently defaulting to free', async ({ page }) => {
    await page.getByTestId('scenario-cache-miss').click();

    await expect(page.getByTestId('displayed-plan')).toHaveText('unknown');
    await expect(page.getByTestId('using-cache')).toHaveText('false');
  });
});
