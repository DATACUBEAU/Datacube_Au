import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

function localOrigin(name) {
  const url = new URL(process.env[name] || '');
  assert.ok(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname));
  assert.ok(url.href === `${url.origin}/`);
  return url.origin;
}

const webOrigin = localOrigin('DATACUBE_TEST_WEB_URL');
const supabaseUrl = localOrigin('DATACUBE_TEST_SUPABASE_URL');
const publicKey = process.env.DATACUBE_TEST_SUPABASE_PUBLIC_KEY;
const serviceKey = process.env.DATACUBE_TEST_SUPABASE_SERVICE_KEY;
assert.ok(publicKey && serviceKey, 'Local Supabase fixture keys are required');
const authOptions = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };
const admin = createClient(supabaseUrl, serviceKey, { auth: authOptions });
const publicClient = () => createClient(supabaseUrl, publicKey, { auth: authOptions });
const createdUsers = [];

async function user(tier) {
  const email = `mobile-${randomUUID()}@example.com`;
  const password = randomBytes(24).toString('base64url');
  const created = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { tier: 'admin', role: 'admin' },
  });
  assert.ok(created.data.user, 'Local Supabase could not create a test user');
  const id = created.data.user.id;
  createdUsers.push(id);
  const profile = await admin.from('au_user_profiles').upsert({ user_id: id, tier })
    .select('tier').single();
  assert.equal(profile.data?.tier, tier);

  const browser = publicClient();
  const signedIn = await browser.auth.signInWithPassword({ email, password });
  assert.ok(signedIn.data.session, 'Local test browser sign-in failed');
  return { id, browser, session: signedIn.data.session };
}

async function post(action, body = {}, token, origin = webOrigin) {
  const headers = { 'Content-Type': 'application/json' };
  if (action === 'approve' || action === 'deny') headers.Origin = origin;
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${webOrigin}/api/auth/mobile-authorization`, {
    method: 'POST', headers, body: JSON.stringify({ action, ...body }),
    redirect: 'error', signal: AbortSignal.timeout(15_000),
  });
  assert.match(response.headers.get('Cache-Control') || '', /no-store/);
  return { status: response.status, body: await response.json() };
}

async function authorization() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier, 'ascii').digest('base64url');
  const { status, body } = await post('create', { challenge });
  assert.equal(status, 201);
  assert.match(body.requestId, /^[\w-]{43}$/);
  assert.match(body.pairingCode, /^[A-Z0-9]{8}$/);
  const remaining = Date.parse(body.expiresAt) - Date.now();
  assert.ok(remaining > 0 && remaining <= 301_000, 'Approval should expire within five minutes');
  return {
    browser: { requestId: body.requestId, pairingCode: body.pairingCode },
    device: { requestId: body.requestId, verifier },
  };
}

async function expectState(action, proof, expected, token) {
  const result = await post(action, proof, token);
  assert.equal(result.status, 200, `${action} returned an unexpected status`);
  assert.equal(result.body.status, expected);
  assert.ok(!result.body.session, `${action} should not disclose a session`);
}

try {
  const standard = await user('free');
  const privileged = await user('admin');
  for (const [label, account] of [['standard', standard], ['admin', privileged]]) {
    const pending = await authorization();
    const accessToken = account.session.access_token;
    await expectState('status', pending.device, 'pending');
    const unauthenticated = await post('approve', pending.browser);
    assert.equal(unauthenticated.status, 401);
    const crossOrigin = await post('approve', pending.browser, accessToken, 'https://example.invalid');
    assert.equal(crossOrigin.status, 403);
    const wrongCode = pending.browser.pairingCode.replace(/^./, (c) => c === 'A' ? 'B' : 'A');
    const wrongApproval = await post('approve', { ...pending.browser, pairingCode: wrongCode }, accessToken);
    assert.equal(wrongApproval.status, 409);
    await expectState('status', pending.device, 'pending');
    await expectState('approve', pending.browser, 'approved', accessToken);
    await expectState('status', pending.device, 'approved');

    const wrongDevice = await post('consume', { ...pending.device, verifier: randomBytes(32).toString('base64url') });
    assert.ok(wrongDevice.status >= 400 && !wrongDevice.body.session);
    const results = await Promise.all([post('consume', pending.device), post('consume', pending.device)]);
    const winners = results.filter(({ body }) => Boolean(body.session));
    assert.equal(winners.length, 1, 'Exactly one proof-bound consume may obtain a session');
    const { status, body } = winners[0];
    assert.equal(status, 200);
    assert.equal(body.status, 'consumed');
    assert.equal(body.userId, account.id);
    assert.ok(body.session.access_token !== accessToken);
    assert.ok(body.session.refresh_token !== account.session.refresh_token);
    const mobileUser = await publicClient().auth.getUser(body.session.access_token);
    assert.equal(mobileUser.data.user?.id, account.id);
    await expectState('consume', pending.device, 'consumed');
    const another = account.id === standard.id ? privileged : standard;
    const reassigned = await post('approve', pending.browser, another.session.access_token);
    assert.equal(reassigned.status, 409);

    const revoked = await admin.auth.admin.signOut(body.session.access_token, 'local');
    assert.ok(!revoked.error, 'Local mobile sign-out failed');
    const stillSignedIn = await account.browser.auth.refreshSession();
    assert.equal(stillSignedIn.data.user?.id, account.id, 'Mobile sign-out must preserve the browser session');
    account.session = stillSignedIn.data.session;
    console.log(`PASS ${label} explicit approval, fallback, proof isolation, one concurrent consume and independent sign-out`);
  }

  const denied = await authorization();
  await expectState('deny', denied.browser, 'denied', standard.session.access_token);
  await expectState('status', denied.device, 'denied');
  await expectState('consume', denied.device, 'denied');
  const cancelled = await authorization();
  await expectState('cancel', cancelled.device, 'cancelled');
  await expectState('consume', cancelled.device, 'cancelled');
  assert.equal((await post('approve', cancelled.browser, privileged.session.access_token)).status, 409);
  console.log('PASS denial and cancellation cannot grant credentials');
} finally {
  for (const id of createdUsers) await admin.auth.admin.deleteUser(id);
}
