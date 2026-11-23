import { expect, test, type Page } from '@playwright/test';

const requestId = 'a'.repeat(43);
const approvalPath = `/mobile-auth/approve?request=${requestId}`;
const returnPath = `/mobile-auth/return?request=${requestId}`;
const pairingCode = 'ABCD2345';

async function mockBrowserOAuth(page: Page, role: 'member' | 'admin') {
  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ci-build.invalid';
  const projectRef = new URL(projectUrl).hostname.split('.')[0];
  const verifierKey = `sb-${projectRef}-auth-token-code-verifier`;
  const user = {
    id: '00000000-0000-4000-8000-000000000047',
    aud: 'authenticated',
    email: `${role}@example.test`,
    app_metadata: { provider: 'google', providers: ['google'], role },
    user_metadata: {},
    role: 'authenticated',
    created_at: '2026-01-01T00:00:00Z',
  };
  const accessToken = 'test-browser-access-token';
  const session = {
    access_token: accessToken,
    refresh_token: 'test-browser-refresh-token',
    token_type: 'bearer',
    expires_in: 3600,
    user,
  };
  await page.addInitScript((key) => localStorage.setItem(key, 'test-pkce-verifier'), verifierKey);
  await page.route('**/auth/v1/token?grant_type=pkce', (route) => route.fulfill({ json: session }));
  await page.route('**/auth/v1/user', (route) => route.fulfill({ json: user }));
  await page.route('**/rest/v1/**', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/auth/activity', (route) => route.fulfill({ json: { ok: true } }));

  const conexCalls: string[] = [];
  await page.route('**/conex/users?mode=access', (route) => {
    conexCalls.push(route.request().url());
    return route.fulfill({ status: role === 'admin' ? 200 : 403, json: {} });
  });

  await page.goto(`/auth/callback?code=mock-oauth-code&next=${encodeURIComponent(approvalPath)}`);
  await expect(page).toHaveURL(new RegExp(`/mobile-auth/approve\\?request=${requestId}$`));
  await expect(page.getByText(`Signed in as ${user.email}`)).toBeVisible();
  expect(conexCalls).toHaveLength(0);
  return accessToken;
}

test('signed-out sign-in retains a validated app request through the Google OAuth redirect', async ({ page }) => {
  await page.goto(approvalPath);
  const signIn = page.getByRole('button', { name: 'Continue with Google' });
  await expect(signIn).toBeEnabled();
  expect(new URL(page.url()).searchParams.get('redirectTo')).toBe(approvalPath);

  await page.route('**/auth/v1/authorize?**', (route) => route.fulfill({ body: 'Google sign-in fixture' }));
  const authorization = page.waitForRequest('**/auth/v1/authorize?**');
  await signIn.click();
  const oauth = new URL((await authorization).url());
  const callback = new URL(oauth.searchParams.get('redirect_to') ?? '');
  expect(oauth.searchParams.get('provider')).toBe('google');
  expect(callback.pathname).toBe('/auth/callback');
  expect(callback.searchParams.get('next')).toBe(approvalPath);
});

test('regular account pairs and approves explicitly before showing the return link', async ({ page }) => {
  const accessToken = await mockBrowserOAuth(page, 'member');
  const decisions: { body: unknown; authorization: string | null; origin: string | null }[] = [];
  await page.route('**/api/auth/mobile-authorization', async (route) => {
    const request = route.request();
    decisions.push({
      body: request.postDataJSON(),
      authorization: await request.headerValue('authorization'),
      origin: await request.headerValue('origin'),
    });
    return route.fulfill({ json: { ok: true, status: 'approved' } });
  });

  const code = page.getByRole('textbox', { name: 'Pairing code' });
  await code.fill('abcd-2345');
  await code.press('Enter');
  await expect(page.getByRole('heading', { name: 'Approve app sign-in' })).toBeVisible();
  expect(decisions).toHaveLength(0);

  await page.getByRole('button', { name: 'Approve sign-in' }).click();
  await expect(page.getByRole('heading', { name: "You're authenticated!" })).toBeVisible();
  await expect(page.getByText('Your DataCube AU app is ready. Return to the app to continue.')).toBeVisible();
  expect(decisions).toEqual([{
    body: { action: 'approve', requestId, pairingCode },
    authorization: `Bearer ${accessToken}`,
    origin: new URL(page.url()).origin,
  }]);
  expect(new URL(page.url()).pathname).toBe('/mobile-auth/approve');

  const openApp = page.getByRole('link', { name: 'Open DataCube AU' });
  await expect(openApp).toHaveAttribute('href', returnPath);
  await openApp.click();
  await expect(page.getByRole('heading', { name: 'Return to DataCube AU' })).toBeVisible();
  await expect(page.getByText('Reopen DataCube AU from your home screen', { exact: false })).toBeVisible();
});

test('admin account can retry a mismatched pairing code and explicitly deny', async ({ page }) => {
  await mockBrowserOAuth(page, 'admin');
  const decisions: unknown[] = [];
  await page.route('**/api/auth/mobile-authorization', (route) => {
    decisions.push(route.request().postDataJSON());
    return decisions.length === 1
      ? route.fulfill({ status: 409, json: { ok: false, code: 'REQUEST_UNAVAILABLE' } })
      : route.fulfill({ json: { ok: true, status: 'denied' } });
  });

  const code = page.getByRole('textbox', { name: 'Pairing code' });
  await code.fill('ZZZZ9999');
  await page.getByRole('button', { name: 'Deny sign-in' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Check the code' })).toBeVisible();
  await code.fill(pairingCode);
  await page.getByRole('button', { name: 'Deny sign-in' }).click();
  await expect(page.getByRole('heading', { name: 'Sign-in denied' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open DataCube AU' })).toHaveCount(0);
  expect(decisions).toEqual([
    { action: 'deny', requestId, pairingCode: 'ZZZZ9999' },
    { action: 'deny', requestId, pairingCode },
  ]);
});

test('malformed approval link is recoverable and its page is not cached', async ({ page }) => {
  const response = await page.goto(`${approvalPath}&request=${requestId}`);
  expect(response?.headers()['cache-control']).toContain('no-store');
  expect(response?.headers()['referrer-policy']).toBe('no-referrer');
  await expect(page.getByRole('heading', { name: 'Open DataCube AU to sign in' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve sign-in' })).toHaveCount(0);
});
