import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function readRepoFile(...segments: string[]): string {
  return readFileSync(path.join(process.cwd(), ...segments), 'utf8');
}

const login = readRepoFile('src', 'app', 'login', 'page.tsx');
const smartAuth = readRepoFile('src', 'hooks', 'use-smart-auth.tsx');
const callback = readRepoFile('src', 'app', 'auth', 'callback', 'page.tsx');
const mobileAppRequired = readRepoFile('src', 'app', 'mobile-app-required', 'page.tsx');
const mobileAuthInstall = readRepoFile('src', 'app', 'mobile-auth', 'install', 'page.tsx');
const dashboardLayout = readRepoFile('src', 'app', 'dashboard', 'dashboard-client-layout.tsx');

assert.match(login, /src="\/icon\.svg"/);
assert.match(login, /dcau-auth-scene/);
assert.match(login, /dcau-auth-mark__halo/);
assert.doesNotMatch(login, /Email and password sign-in and registration are not available/);
assert.doesNotMatch(mobileAppRequired, /browser-based product workspace has been retired|Account, subscription, billing and Conex Admin services/);
assert.match(mobileAppRequired, /Get the app for a smarter way/);
assert.doesNotMatch(mobileAuthInstall, /Your account is authenticated on the website|Your website sign-in was successful/);
assert.match(login, /signInWithGoogle/);
assert.match(login, /Continue with Google/);
assert.doesNotMatch(login, /signInWithPassword|signUp\(|handleEmailAuth|PasswordInput|type="password"|TabsTrigger/);
assert.match(login, /sanitizeRedirectTarget\(\s*redirectToParam,\s*typeof window === 'undefined' \? null : window\.location\.origin,\s*'\/',?\s*\)/);
assert.match(login, /isConexDestination \|\| safeRedirectPath === '\/'/);
assert.match(login, /\/conex\/users\?mode=access/);
assert.match(login, /router\.replace\('\/conex'\)/);
assert.match(login, /router\.replace\(safeRedirectPath\)/);
assert.match(login, /disabled=\{isLoadingGoogle\}/);
assert.match(smartAuth, /\/auth\/callback\?next=/);
assert.match(smartAuth, /: '\/'/);
assert.match(callback, /exchangeCodeForSession\(code\)/);
assert.match(callback, /fetch\('\/conex\/users\?mode=access'/);
assert.match(callback, /if \(accessResponse\?\.ok\)[\s\S]+router\.replace\('\/conex'\)/);
assert.match(dashboardLayout, /signInWithGoogle\('\/dashboard'\)/);
assert.doesNotMatch(dashboardLayout, /setTimeout\(resolve, 1500\)|Authenticating|Please do not close this window/);
assert.doesNotMatch(dashboardLayout, /supabase\.auth\.signInWithOAuth/);
assert.match(callback, /syncServerAuthSessionCookie\(session\)/);
console.log('PASS Google-only website authentication entry and redirect handling');
