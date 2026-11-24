import { expect, test } from '@playwright/test';

test.describe('Auth guard redirects', () => {
  test('redirects unauthenticated account settings before protected content renders', async ({ request }) => {
    const response = await request.get('/dashboard/settings', {
      failOnStatusCode: false,
      maxRedirects: 0,
    });

    expect([302, 303, 307, 308]).toContain(response.status());

    const location = new URL(response.headers()['location'] ?? '', response.url());
    expect(location.pathname).toBe('/');
    expect(location.search).toBe('');

    const body = await response.text();
    expect(body).not.toContain('Plan Status');
  });

  test('routes the retired documents page to the Android app notice', async ({ request }) => {
    const response = await request.get('/dashboard/documents', {
      failOnStatusCode: false,
      maxRedirects: 0,
    });

    expect([302, 303, 307, 308]).toContain(response.status());
    const location = new URL(response.headers()['location'] ?? '', response.url());
    expect(location.pathname).toBe('/mobile-app-required');
    expect(await response.text()).not.toContain('Plan Status');
  });

  test('keeps other test paths retired on the development server', async ({ request }) => {
    const response = await request.get('/test/not-a-fixture', {
      failOnStatusCode: false,
      maxRedirects: 0,
    });

    expect([302, 303, 307, 308]).toContain(response.status());
    const location = new URL(response.headers()['location'] ?? '', response.url());
    expect(location.pathname).toBe('/mobile-app-required');
  });

  test('redirects unauthenticated conex route before admin content renders', async ({ request }) => {
    const response = await request.get('/conex', {
      failOnStatusCode: false,
      maxRedirects: 0,
    });

    expect([302, 303, 307, 308]).toContain(response.status());

    const location = response.headers()['location'] ?? '';
    const decoded = decodeURIComponent(location);
    expect(new URL(decoded, response.url()).pathname).toBe('/');

    const body = await response.text();
    expect(body).not.toContain('AU Central Command');
    expect(body).not.toContain('Billing Controls');
  });
  test('admin API denies unsigned requests without HTML redirects', async ({ request }) => {
    const res = await request.get('/conex/users?mode=access', { maxRedirects: 0, failOnStatusCode: false });
    expect(res.status()).toBe(401);
    expect(res.headers()['content-type']).toContain('application/json');
    expect(res.headers()['cache-control']).toContain('no-store');
  });
});
