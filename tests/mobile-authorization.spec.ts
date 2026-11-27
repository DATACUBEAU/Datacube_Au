import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

const requestId = 'a'.repeat(43);
const approvalPath = `/mobile-auth/approve?request=${requestId}`;
const returnPath = `/mobile-auth/return?request=${requestId}`;
const pairingCode = 'ABCD2345';

async function mockBrowserOAuth(page: Page, role: 'member' | 'admin', fallback = false, cookieOnly = false) {
  test.slow();
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
  if (cookieOnly) {
    await page.goto(`/login?redirectTo=${encodeURIComponent(approvalPath)}&forceReauth=1`);
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
    expect((await page.context().cookies()).find((c) => c.name === 'dcau-mobile-pairing-request')?.httpOnly).toBe(true);
  }
  await page.addInitScript(({ key, path, cookieOnly }) => {
    localStorage.setItem(key, 'test-pkce-verifier');
    if (!cookieOnly) sessionStorage.setItem('dcau:pending-mobile-oauth', JSON.stringify({ path, createdAt: Date.now() }));
    else sessionStorage.removeItem('dcau:pending-mobile-oauth');
  }, { key: verifierKey, path: approvalPath, cookieOnly });
  await page.route('**/api/auth/session?grant_type=pkce', (route) => route.fulfill({ json: session }));
  await page.route('**/auth/v1/user', (route) => route.fulfill({ json: user }));
  await page.route('**/rest/v1/**', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/auth/activity', (route) => route.fulfill({ json: { ok: true } }));

  const conexCalls: string[] = [];
  await page.route('**/conex/users?mode=access', (route) => {
    conexCalls.push(route.request().url());
    return route.fulfill({ status: role === 'admin' ? 200 : 403, json: {} });
  });

  await page.goto(fallback ? '/?code=mock-oauth-code' : '/auth/callback?code=mock-oauth-code');
  await expect(page).toHaveURL(new RegExp(`/mobile-auth/approve\\?request=${requestId}$`), { timeout: 30_000 });
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
  const loginOrigin = new URL(page.url()).origin;
  const authorization = page.waitForRequest('**/auth/v1/authorize?**');
  await signIn.click();
  const oauth = new URL((await authorization).url());
  const callback = new URL(oauth.searchParams.get('redirect_to') ?? '');
  expect(oauth.searchParams.get('provider')).toBe('google');
  expect(callback.pathname).toBe('/auth/callback');
  expect(callback.origin).toBe(loginOrigin);
  expect(callback.search).toBe('');
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

test('Site URL fallback recovers the pending mobile request instead of showing the download page', async ({ page }) => {
  await mockBrowserOAuth(page, 'member', true);
  await expect(page.getByRole('heading', { name: 'Approve app sign-in' })).toBeVisible();
  await expect(page.getByText('Download AU. See what it can do.')).toHaveCount(0);
});

test('callback without a pending request offers a restart instead of redirecting home', async ({ page }) => {
  await page.goto('/auth/callback?code=orphaned-code');
  await expect(page.getByRole('status')).toContainText('Return to the DataCube AU app');
  expect(new URL(page.url()).pathname).toBe('/auth/callback');
});

test('server pairing context survives missing browser tab storage and Site URL fallback', async ({ page }) => {
  await mockBrowserOAuth(page, 'member', true, true);
  await expect(page.getByRole('textbox', { name: 'Pairing code' })).toBeVisible();
});

test('public distribution stays public with an unfinished mobile sign-in and stale auth lock', async ({ page }) => {
  await page.goto(`/login?redirectTo=${encodeURIComponent(approvalPath)}&forceReauth=1`);
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
  expect((await page.context().cookies()).some(c => c.name === 'dcau-mobile-pairing-request')).toBe(true);
  await page.addInitScript(() => {
    localStorage.setItem('dcau:auth-runtime-state', 'EXPIRED');
    localStorage.setItem('dcau:auth-actions-disabled', '1');
  });
  await page.route('**/api/android-update', route => route.fulfill({json:{
    schema:1, versionCode:1, versionName:'1.0.0', sizeBytes:1000000,
    sha256:'a'.repeat(64),
    apkUrl:'https://github.com/DATACUBEAU/Datacube_Au/releases/download/android-test-aaaaaaaaaaaa/DataCube-AU-Android-arm64.apk',
    notes:'',
  }}));
  await page.goto('/');
  await page.getByRole('link', { name: 'Download for Android' }).first().click();
  await expect(page).toHaveURL(/\/download$/);
  await expect(page.getByRole('heading', { name: 'Get the Android app' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download AU for Android' })).toHaveAttribute('href', /github\.com\/DATACUBEAU/);
  await page.goto('/mobile-app-required');
  await expect(page).toHaveURL(/\/mobile-app-required$/);
});

test('malformed mobile login must not fall back to the website', async ({ page }) => {
  await page.goto('/login?redirectTo=%2Fmobile-auth%2Fapprove%3Frequest%3Dinvalid');
  await expect(page.getByRole('heading', { name: 'Return to DataCube AU' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toHaveCount(0);
});

test('fresh Android login performs a real SDK PKCE round trip without seeded verifier', async ({ page }) => {
  test.slow();
  const user = {
    id: '00000000-0000-4000-8000-000000000047',
    aud: 'authenticated', email: 'member@example.test',
    app_metadata: { provider: 'google', providers: ['google'] },
    user_metadata: {}, role: 'authenticated', created_at: '2026-01-01T00:00:00Z',
  };
  const session = {
    access_token: 'test-browser-access-token', refresh_token: 'test-browser-refresh-token',
    token_type: 'bearer', expires_in: 3600, user,
  };
  let challenge: string | null = null;
  let matched = false;
  await page.route('**/auth/v1/authorize?**', async (route) => {
    const url = new URL(route.request().url());
    challenge = url.searchParams.get('code_challenge');
    expect(challenge).toBeTruthy();
    expect(url.searchParams.get('code_challenge_method')?.toLowerCase()).toBe('s256');
    const callback = new URL(url.searchParams.get('redirect_to')!);
    callback.searchParams.set('code', 'test-fresh-code');
    // Simulate Google returning via Supabase; do not seed a verifier.
    await route.fulfill({ status: 302, headers: { location: callback.toString() } });
  });
  await page.route('**/api/auth/session?grant_type=pkce', async (route) => {
    const body = route.request().postDataJSON();
    expect(body.auth_code).toBe('test-fresh-code');
    expect(new URL(route.request().url()).origin).toBe(new URL(page.url()).origin);
    expect(await route.request().headerValue('authorization')).toBeNull();
    expect(await route.request().headerValue('apikey')).toBeNull();
    expect(typeof body.code_verifier).toBe('string');
    matched = createHash('sha256').update(body.code_verifier).digest('base64url') === challenge;
    expect(matched).toBe(true);
    await route.fulfill({ json: session });
  });
  await page.route('**/auth/v1/user', (route) => route.fulfill({ json: user }));
  await page.route('**/rest/v1/**', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/auth/activity', (route) => route.fulfill({ json: { ok: true } }));
  await page.goto(`/login?redirectTo=${encodeURIComponent(approvalPath)}&forceReauth=1`);
  const button = page.getByRole('button', { name: 'Continue with Google' });
  await expect(button).toBeEnabled();
  await button.click();
  await expect(page.getByRole('textbox', { name: 'Pairing code' })).toBeVisible({ timeout: 30000 });
  expect(matched).toBe(true);
});


test('an orphaned browser auth lock does not prevent mobile PKCE exchange', async ({ page, context }) => {
  test.slow();
  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ci-build.invalid';
  const projectRef = new URL(projectUrl).hostname.split('.')[0];
  const lockName = `lock:sb-${projectRef}-auth-token`;
  // A separate tab models an older browser operation that never releases
  // its lock. No real session, account, or provider is involved.
  const holder = await context.newPage();
  await holder.route('**/auth-lock-fixture', (route) => route.fulfill({ contentType: 'text/html', body: '<html><body>Lock fixture</body></html>' }));
  await holder.goto('/auth-lock-fixture');
  await holder.evaluate(async (name) => {
    await new Promise<void>((resolve) => {
      void navigator.locks.request(name, async () => {
        resolve();
        await new Promise<void>(() => {});
      }).catch(() => {});
    });
  }, lockName);
  try {
    await mockBrowserOAuth(page, 'member');
    await expect(page.getByRole('textbox', { name: 'Pairing code' })).toBeVisible();
  } finally {
    await holder.close();
  }
});
