import { expect, test } from '@playwright/test';

test.describe('API error resilience', () => {
  test('returns unauthorized when proxy requests lack auth', async ({ request }) => {
    const response = await request.post('/api/proxy/au-chat', {
      data: { user_input: 'hello' },
      failOnStatusCode: false,
    });

    expect(response.status()).toBe(401);
    const payload = await response.json();
    expect(payload.error).toBe('unauthorized');
  });
});
