import { expect, test } from '@playwright/test';

test.describe('API error resilience', () => {
  test('keeps the retired VPS ticket endpoint unavailable', async ({ request }) => {
    const response = await request.post('/api/au/vps-ticket', {
      data: { feature: 'chat', user_input: 'hello' },
      failOnStatusCode: false,
    });

    // VPS ticket issuance is retired with the browser AI workspace.
    // A missing route is the intended fail-closed result; it must not
    // silently reappear as an unauthenticated proxy or server endpoint.
    expect(response.status()).toBe(404);
  });

  test('preserves unauthorized status on the current chat history boundary', async ({ request }) => {
    const response = await request.get('/api/chat/history?sessionId=ci-missing-auth', {
      failOnStatusCode: false,
    });

    expect(response.status()).toBe(401);
    const payload = await response.json();
    expect(payload.code).toBe('UNAUTHORIZED');
    expect(payload.message).toBe('Authentication required.');
    expect(typeof payload.requestId).toBe('string');
  });
});
