import { expect, test, type Locator } from '@playwright/test';

const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 414, height: 896 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
];

async function assertScrollableIfNeeded(panelViewport: Locator) {
  const metrics = await panelViewport.evaluate((node: HTMLElement) => ({
    clientHeight: node.clientHeight,
    scrollHeight: node.scrollHeight,
    scrollTop: node.scrollTop,
  }));

  expect(metrics.clientHeight).toBeGreaterThan(0);
  expect(metrics.scrollHeight).toBeGreaterThan(0);

  if (metrics.scrollHeight > metrics.clientHeight + 1) {
    await panelViewport.evaluate((node: HTMLElement) => {
      node.scrollTop = node.scrollHeight;
    });

    const afterScroll = await panelViewport.evaluate((node: HTMLElement) => ({
      scrollTop: node.scrollTop,
      maxScrollTop: node.scrollHeight - node.clientHeight,
    }));

    expect(afterScroll.maxScrollTop).toBeGreaterThan(0);
    expect(afterScroll.scrollTop).toBeGreaterThan(0);
  }
}

test.describe('DataCube AU guide scroll behavior', () => {
  test('keeps guide content vertically accessible from 320px to 2560px', async ({ page }) => {
    test.setTimeout(90_000);

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await page.goto('/guide-preview', { waitUntil: 'domcontentloaded' });

      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();

      const dialogBox = await dialog.boundingBox();
      expect(dialogBox).not.toBeNull();
      if (dialogBox) {
        expect(dialogBox.y).toBeGreaterThanOrEqual(-1);
        expect(dialogBox.y + dialogBox.height).toBeLessThanOrEqual(viewport.height + 1);
      }

      const guidePanelViewport = page
        .locator('[role="tabpanel"][data-state="active"] [data-radix-scroll-area-viewport]')
        .first();
      await expect(guidePanelViewport).toBeVisible();
      await assertScrollableIfNeeded(guidePanelViewport);

      const lastGuideSection = page.getByRole('heading', { name: 'Settings & Subscription' });
      await lastGuideSection.scrollIntoViewIfNeeded();
      await expect(lastGuideSection).toBeVisible();

      await page.getByRole('tab', { name: 'Install App' }).click();

      const installPanelViewport = page
        .locator('[role="tabpanel"][data-state="active"] [data-radix-scroll-area-viewport]')
        .first();
      await expect(installPanelViewport).toBeVisible();
      await assertScrollableIfNeeded(installPanelViewport);

      const installLastStep = page.getByText(/desktop\/start menu/i);
      await installLastStep.scrollIntoViewIfNeeded();
      await expect(installLastStep).toBeVisible();
    }
  });
});
