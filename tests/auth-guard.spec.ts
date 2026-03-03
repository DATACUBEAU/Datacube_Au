import { expect, test } from '@playwright/test';

test.describe('Auth guard redirects', () => {
  test('redirects unauthenticated dashboard route before protected content renders', async ({ request }) => {
    const response = await request.get('/dashboard/documents', {
      failOnStatusCode: false,
      maxRedirects: 0,
    });

    expect([302, 303, 307, 308]).toContain(response.status());

    const location = response.headers()['location'] ?? '';
    const decoded = decodeURIComponent(location);
    expect(decoded).toContain('/login');
    expect(decoded).toContain('/dashboard/documents');

    const body = await response.text();
    expect(body).not.toContain('Plan Status');
    expect(body).not.toContain('AU Chat');
  });
});
