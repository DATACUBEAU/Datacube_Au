import { expect, test } from '@playwright/test';

test.describe('Account snapshot route compatibility', () => {
  test('legacy snapshot route matches the canonical effective route for unauthenticated bootstrap', async ({ request }) => {
    const [canonical, legacy] = await Promise.all([
      request.get('/api/account/effective', { failOnStatusCode: false }),
      request.get('/api/account/snapshot', { failOnStatusCode: false }),
    ]);

    expect(canonical.status()).toBe(401);
    expect(legacy.status()).toBe(401);

    const canonicalBody = await canonical.json();
    const legacyBody = await legacy.json();

    expect(legacyBody.ok).toBe(canonicalBody.ok);
    expect(legacyBody.code).toBe(canonicalBody.code);
    expect(legacyBody.message).toBe(canonicalBody.message);
  });
});
