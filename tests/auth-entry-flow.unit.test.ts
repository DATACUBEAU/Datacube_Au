import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function readRepoFile(...segments: string[]): string {
  return readFileSync(path.join(process.cwd(), ...segments), 'utf8');
}

const login = readRepoFile('src', 'app', 'login', 'page.tsx');
const smartAuth = readRepoFile('src', 'hooks', 'use-smart-auth.tsx');
const callback = readRepoFile('src', 'app', 'auth', 'callback', 'page.tsx');
const dashboardLayout = readRepoFile('src', 'app', 'dashboard', 'dashboard-client-layout.tsx');

assert.match(login, /signInWithGoogle/);
assert.match(login, /Continue with Google/);
assert.doesNotMatch(login, /signInWithPassword|signUp\(|handleEmailAuth|PasswordInput|type="password"|TabsTrigger/);
assert.match(login, /sanitizeLocalRedirectPath\(redirectToParam, '\/'\)/);
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
