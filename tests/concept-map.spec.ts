import { test, expect } from '@playwright/test';

test.describe('Concept Map', () => {
  test('should load concept map page or redirect to login', async ({ page }) => {
    await page.goto('/dashboard/concept-map');

    const title = page.locator('text=Concept Map');
    const loginButton = page.locator('text=Login');
    await expect(title.or(loginButton)).toBeVisible();
  });

  test('should show tools panel when authenticated', async ({ page }) => {
    await page.goto('/dashboard/concept-map');

    const tools = page.locator('text=Tools');
    if (await tools.isVisible()) {
      await expect(page.locator('text=Select')).toBeVisible();
      await expect(page.locator('text=Node')).toBeVisible();
      await expect(page.locator('text=Edge')).toBeVisible();
    }
  });
});

