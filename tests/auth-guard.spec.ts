import { expect, test } from '@playwright/test';

test.describe('Auth guard redirects', () => {
  test('redirects unauthenticated account settings before protected content renders', async ({ request }) => {
    const response = await request.get('/dashboard/settings', {
      failOnStatusCode: false,
      maxRedirects: 0,
    });

    expect([302, 303, 307, 308]).toContain(response.status());

    const location = new URL(response.headers()['location'] ?? '', response.url());
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('redirectTo')).toBe('/dashboard/settings');

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
    expect(decoded).toContain('/login');
    expect(decoded).toContain('/conex');

    const body = await response.text();
    expect(body).not.toContain('AU Central Command');
    expect(body).not.toContain('Billing Controls');
  });
});
