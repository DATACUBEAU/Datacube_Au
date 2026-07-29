import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

let failed = 0;

type AsyncTest = () => void | Promise<void>;

function readRepoFile(...segments: string[]): string {
  return readFileSync(path.join(process.cwd(), ...segments), 'utf8');
}

async function run(name: string, fn: AsyncTest) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error: any) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error?.stack || error);
  }
}

async function main() {
  await run('no session or restoring auth does not remove login/signup entry actions', () => {
    const login = readRepoFile('src', 'app', 'login', 'page.tsx');
    assert.match(login, /signInWithPassword/);
    assert.match(login, /signUp/);
    assert.match(login, /TabsTrigger value="login"/);
    assert.match(login, /TabsTrigger value="signup"/);
    assert.match(login, /disabled=\{isLoadingEmail \|\| !email\.trim\(\) \|\| !password\}/);
    assert.match(login, /disabled=\{isLoadingGoogle\}/);
    assert.doesNotMatch(login, /disabled=\{[^}]*isSmartLoading/);
    assert.doesNotMatch(login, /if \(isUserLoading \|\| isResolvingRedirect\)/);
    assert.match(login, /isResolvingRedirect \|\| \(isUserLoading && Boolean\(user\)\)/);
  });

  await run('login success syncs server auth cookie and redirects to dashboard target', () => {
    const login = readRepoFile('src', 'app', 'login', 'page.tsx');
    assert.match(login, /supabase\.auth\.signInWithPassword/);
    assert.match(login, /syncServerAuthSessionCookie\(data\.session\)/);
    assert.match(login, /router\.replace\(safeRedirectPath\)/);
    assert.match(login, /Email or password is incorrect\./);
  });

  await run('signup success redirects or shows a clear email confirmation message', () => {
    const login = readRepoFile('src', 'app', 'login', 'page.tsx');
    assert.match(login, /supabase\.auth\.signUp/);
    assert.match(login, /emailRedirectTo/);
    assert.match(login, /\/auth\/callback\?next=/);
    assert.match(login, /Check your email to confirm your account, then sign in\./);
    assert.match(login, /Account created/);
  });

  await run('OAuth uses a public callback route instead of redirecting directly to protected pages', () => {
    const smartAuth = readRepoFile('src', 'hooks', 'use-smart-auth.tsx');
    assert.match(smartAuth, /\/auth\/callback\?next=\$\{encodeURIComponent\(safePath\)\}/);
    assert.doesNotMatch(smartAuth, /window\.location\.origin\}\$\{safePath\}/);
  });

  await run('auth callback exchanges code, syncs cookie, and never logs raw session values', () => {
    const callbackPath = path.join(process.cwd(), 'src', 'app', 'auth', 'callback', 'page.tsx');
    assert.equal(existsSync(callbackPath), true);
    const callback = readFileSync(callbackPath, 'utf8');
    assert.match(callback, /exchangeCodeForSession\(code\)/);
    assert.match(callback, /syncServerAuthSessionCookie\(session\)/);
    assert.match(callback, /markAuthSessionRestored\('auth-callback'\)/);
    assert.match(callback, /markAuthUnauthenticated\('auth-callback'/);
    assert.match(callback, /NEXT_PUBLIC_DCAU_AUTH_DEBUG/);
    assert.doesNotMatch(callback, /console\.(log|info|warn|error)\([^)]*(access_token|refresh_token|Authorization|Cookie|apikey|token)/i);
  });

  await run('session cleanup does not clear a freshly created login/signup session', () => {
    const smartAuth = readRepoFile('src', 'hooks', 'use-smart-auth.tsx');
    assert.match(smartAuth, /fresh_session_detected/);
    assert.match(smartAuth, /sessionSignatureRef\.current && authStateRef\.current === 'authenticated'/);
    const guardIndex = smartAuth.indexOf('fresh_session_detected');
    const clearIndex = smartAuth.indexOf('clearClientAuthStorageArtifacts', guardIndex);
    assert.ok(guardIndex >= 0, 'missing fresh-session guard');
    assert.ok(clearIndex > guardIndex, 'fresh-session guard should run before storage cleanup');
  });

  await run('protected routes redirect unauthenticated users while auth routes stay public', () => {
    const middleware = readRepoFile('src', 'middleware.ts');
    const accessControl = readRepoFile('src', 'lib', 'authz', 'access-control.ts');
    const signup = readRepoFile('src', 'app', 'signup', 'page.tsx');
    assert.match(middleware, /loginRedirect/);
    assert.match(middleware, /redirectTo/);
    assert.match(accessControl, /pathname: '\/dashboard'/);
    assert.doesNotMatch(accessControl, /pathname: '\/login'/);
    assert.doesNotMatch(accessControl, /pathname: '\/signup'/);
    assert.doesNotMatch(accessControl, /pathname: '\/auth\/callback'/);
    assert.match(signup, /export \{ default \} from '..\/login\/page'/);
  });

  await run('safeFetch and service worker recovery do not own login/signup submit state', () => {
    const login = readRepoFile('src', 'app', 'login', 'page.tsx');
    const swRegister = readRepoFile('src', 'components', 'service-worker-register.tsx');
    const swUpdater = readRepoFile('src', 'components', 'service-worker-updater.tsx');
    assert.doesNotMatch(login, /safeFetch/);
    assert.match(swRegister, /ensureHealthyServiceWorkerRegistration/);
    assert.match(swRegister, /recoverBrokenServiceWorkerRuntime/);
    assert.match(swUpdater, /refreshHealthyServiceWorkers/);
  });

  if (failed > 0) {
    process.exit(1);
  }
}

void main();
