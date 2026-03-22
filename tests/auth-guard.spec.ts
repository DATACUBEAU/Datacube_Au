import { expect, test } from '@playwright/test';

test.describe('Auth guard redirects', () => {
  test('dashboard shell renders sign-in state without hard-redirecting during client auth restore', async ({ request }) => {
    const response = await request.get('/dashboard/documents', {
      failOnStatusCode: false,
      maxRedirects: 0,
    });

    expect(response.status()).toBe(200);
    expect(response.headers()['location']).toBeFalsy();

    const body = await response.text();
    expect(body).toContain('DataCube AU');
    expect(body).not.toContain('Plan Status');
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
