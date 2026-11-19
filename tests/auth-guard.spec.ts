import { expect, test } from '@playwright/test';

test.describe('Auth guard redirects', () => {
  test('retires browser dashboard routes and sends customers to the native-app notice', async ({ request }) => {
    const response = await request.get('/dashboard/documents', {
      failOnStatusCode: false,
      maxRedirects: 0,
    });

    expect([302, 303, 307, 308]).toContain(response.status());

    const location = response.headers()['location'] ?? '';
    const redirected = new URL(location, 'http://localhost');
    expect(redirected.pathname).toBe('/login');
    expect(redirected.searchParams.get('notice')).toBe('mobile_app_required');
    expect(redirected.searchParams.has('redirectTo')).toBe(false);

    const body = await response.text();
    expect(body).not.toContain('Plan Status');
    expect(body).not.toContain('Documents');
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
