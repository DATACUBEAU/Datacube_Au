import { expect, test } from '@playwright/test';
import { runReadinessProbe } from '../src/lib/server/health-readiness';
import { readFileSync } from 'node:fs';
import path from 'node:path';

test.describe('Network health and offline resilience', () => {
  test('readiness endpoint is excluded from generic API caching', async () => {
    const nextConfig = readFileSync(path.join(process.cwd(), 'next.config.ts'), 'utf8');

    // Assert the canonical source-level guard rather than relying on a brittle
    // regex-of-regexes representation. This keeps the regression check stable
    // while still requiring the generic API cache matcher to reject readiness.
    expect(nextConfig).toContain("if (/\\/api\\/health(?:\\/ready)?$/i.test(url.pathname)) return false;");
  });

  test('readiness helper reports healthy dependencies without leaking internals', async () => {
    const result = await runReadinessProbe({
      check: async () => undefined,
      timeoutMs: 1000,
    });

    expect(result.ok).toBe(true);
    expect(result.dependency).toBe('ok');
    expect(Number.isFinite(result.durationMs)).toBe(true);
  });

  test('readiness helper sanitizes dependency failures', async () => {
    const result = await runReadinessProbe({
      check: async () => {
        throw new Error('sensitive database implementation detail');
      },
      timeoutMs: 1000,
    });

    expect(result.ok).toBe(false);
    expect(result.dependency).toBe('unavailable');
    expect(JSON.stringify(result)).not.toContain('sensitive');
  });

  test('readiness helper bounds hung dependency checks and aborts them', async () => {
    let signalWasAborted = false;
    const result = await runReadinessProbe({
      timeoutMs: 100,
      check: async (signal) => {
        await new Promise<void>(() => {
          signal.addEventListener('abort', () => {
            signalWasAborted = true;
          }, { once: true });
        });
      },
    });

    expect(result.ok).toBe(false);
    expect(result.dependency).toBe('timeout');
    expect(signalWasAborted).toBe(true);
    expect(result.durationMs).toBeGreaterThanOrEqual(90);
    expect(result.durationMs).toBeLessThan(1000);
  });

  test('returns ok from /api/health', async ({ request }) => {
    const response = await request.get('/api/health', { failOnStatusCode: false });
    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.ok).toBe(true);
  });

  test('keeps liveness separate from datastore readiness', async ({ request }) => {
    const response = await request.get('/api/health/ready', { failOnStatusCode: false });
    expect([200, 503]).toContain(response.status());
    expect(response.headers()['cache-control']).toContain('no-store');

    const data = await response.json();
    expect(typeof data.ok).toBe('boolean');
    expect(['ready', 'degraded']).toContain(data.status);
    expect(['ok', 'unavailable', 'timeout']).toContain(data.checks?.database);
    expect(typeof data.request_id).toBe('string');
    expect(JSON.stringify(data)).not.toContain('ci-build-placeholder-service-role-key');
    expect(JSON.stringify(data)).not.toContain('ci-build.invalid');

    if (response.status() === 200) {
      expect(data.ok).toBe(true);
      expect(data.status).toBe('ready');
      expect(data.checks.database).toBe('ok');
    } else {
      expect(data.ok).toBe(false);
      expect(data.status).toBe('degraded');
      expect(['unavailable', 'timeout']).toContain(data.checks.database);
    }
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
