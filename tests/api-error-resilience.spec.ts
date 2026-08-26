import { expect, test } from '@playwright/test';

test.describe('API error resilience', () => {
  test('returns unauthorized when VPS ticket requests lack auth', async ({ request }) => {
    const response = await request.post('/api/au/vps-ticket', {
      data: { feature: 'chat', user_input: 'hello' },
      failOnStatusCode: false,
    });

    expect(response.status()).toBe(401);
    const payload = await response.json();
    expect(payload.code).toBe('UNAUTHORIZED');
    expect(payload.message).toBe('Authentication required.');
    expect(String(payload.code || '')).not.toBe('INTERNAL_SERVER_ERROR');
    expect(typeof payload.requestId).toBe('string');
  });

  test('preserves unauthorized status on the current chat history boundary', async ({ request }) => {
    const response = await request.get('/api/chat/history?sessionId=ci-missing-auth', {
      failOnStatusCode: false,
    });

    expect(response.status()).toBe(401);
    const payload = await response.json();
    expect(payload.code).toBe('UNAUTHORIZED');
    expect(payload.message).toBe('Authentication required.');
    expect(payload.details?.reason).toBe('missing_token');
    expect(typeof payload.requestId).toBe('string');
  });
});