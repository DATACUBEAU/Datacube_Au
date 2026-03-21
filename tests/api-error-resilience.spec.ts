import { expect, test } from '@playwright/test';

test.describe('API error resilience', () => {
  test('returns unauthorized when proxy requests lack auth', async ({ request }) => {
    const response = await request.post('/api/proxy/au-chat', {
      data: { user_input: 'hello' },
      failOnStatusCode: false,
    });

    expect(response.status()).toBe(401);
    const payload = await response.json();
    expect(payload.code).toBe('UNAUTHORIZED');
    expect(payload.message).toBe('Authentication failed.');
    expect(payload.status).toBe(401);
    expect(String(payload.code || '')).not.toBe('INTERNAL_SERVER_ERROR');
    expect(payload.details?.reason).toBe('missing_token');
    expect(typeof payload.requestId).toBe('string');
  });

  test('preserves unauthorized status through /api/chat wrapper', async ({ request }) => {
    const response = await request.post('/api/chat', {
      data: { question: 'hello' },
      failOnStatusCode: false,
    });

    expect(response.status()).toBe(401);
    const payload = await response.json();
    expect(payload.status).toBe(401);
    expect(payload.code).toBe('UNAUTHORIZED');
    expect(payload.message).toBe('Authentication failed.');
    expect(payload.details?.reason).toBe('missing_token');
  });
});
