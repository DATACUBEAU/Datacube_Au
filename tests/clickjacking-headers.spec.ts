import { expect, test } from '@playwright/test';

const protectedRoutes = ['/', '/dashboard', '/conex'];

test.describe('Clickjacking protection headers', () => {
  for (const route of protectedRoutes) {
    test(`returns CSP frame-ancestors and X-Frame-Options on ${route}`, async ({ request }) => {
      const response = await request.get(route, {
        failOnStatusCode: false,
        maxRedirects: 0,
      });

      const headers = response.headers();
      const csp = headers['content-security-policy'] ?? '';

      expect(csp.toLowerCase()).toContain("frame-ancestors 'none'");
      expect(headers['x-frame-options']).toBe('DENY');
    });
  }
});
