import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function read(...parts: string[]): string {
  return readFileSync(path.join(process.cwd(), ...parts), 'utf8');
}

const route = read('src', 'app', 'api', 'auth', 'mobile-handoff', 'route.ts');
const migration = read('supabase', 'migrations', '20261118090000_mobile_auth_handoffs.sql');
const completion = read('src', 'app', 'mobile-auth', 'complete', 'page.tsx');
const fallback = read('src', 'app', 'mobile-auth', 'install', 'page.tsx');
const androidAuthScreen = read('apps', 'android', 'app', 'src', 'main', 'java', 'au', 'datacube', 'app', 'ui', 'auth', 'AuthScreen.kt');
const androidRepository = read('apps', 'android', 'app', 'src', 'main', 'java', 'au', 'datacube', 'app', 'auth', 'AuthRepository.kt');
const pendingStore = read('apps', 'android', 'app', 'src', 'main', 'java', 'au', 'datacube', 'app', 'auth', 'PendingMobileAuthStore.kt');
const androidManifest = read('apps', 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
const websiteLogin = read('src', 'app', 'login', 'page.tsx');
const websiteCallback = read('src', 'app', 'auth', 'callback', 'page.tsx');
const middleware = read('src', 'middleware.ts');

assert.match(androidAuthScreen, /Sign In/);
assert.match(androidAuthScreen, /Create Account/);
assert.match(androidAuthScreen, /onOpenWebsite/);
assert.doesNotMatch(androidAuthScreen, /OutlinedTextField|PasswordVisualTransformation|signIn\(|signUp\(/);

assert.match(androidRepository, /BuildConfig\.AUTH_WEBSITE_URL/);
assert.match(androidRepository, /code_challenge/);
assert.match(androidRepository, /\/api\/auth\/mobile-handoff/);
assert.match(androidRepository, /refreshSession\(refreshToken\)/);
assert.match(androidRepository, /actualUserId != expectedUserId/);
assert.match(androidRepository, /importSession/);
assert.doesNotMatch(androidRepository, /signInWith\(Email\)|signUpWith\(Email\)/);
assert.match(pendingStore, /AndroidKeyStore/);
assert.match(pendingStore, /AES\/GCM\/NoPadding/);
assert.match(pendingStore, /MAX_AGE_MS/);

assert.match(androidManifest, /android:icon="@mipmap\/ic_launcher"/);
assert.match(androidManifest, /android:roundIcon="@mipmap\/ic_launcher_round"/);
assert.match(androidManifest, /android:launchMode="singleTop"/);
assert.match(androidManifest, /android:scheme="datacube"/);
assert.match(androidManifest, /android:host="auth-callback"/);

assert.match(route, /requireUserFromRequest\(request\)/);
assert.match(route, /auth\.source !== 'header'/);
assert.match(route, /refreshSession\(\{/);
assert.match(route, /session\.user\?\.id !== auth\.userId/);
assert.match(route, /aes-256-gcm/);
assert.match(route, /code_hash/);
assert.match(route, /state_hash/);
assert.match(route, /code_challenge/);
assert.match(route, /\.is\('consumed_at', null\)/);
assert.match(route, /\.gt\('expires_at', now\)/);
assert.match(route, /Cache-Control.*no-store/s);
assert.doesNotMatch(route, /console\.(log|info|warn|error)\([^)]*(access_token|refresh_token|Authorization)/i);

assert.match(migration, /references auth\.users\(id\) on delete cascade/i);
assert.match(migration, /enable row level security/i);
assert.match(migration, /revoke all on table public\.au_mobile_auth_handoffs from public, anon, authenticated/i);
assert.match(migration, /grant all on table public\.au_mobile_auth_handoffs to service_role/i);

assert.match(completion, /exchange|mobile-handoff/);
assert.match(completion, /supabase\.auth\.setSession/);
assert.match(completion, /sessionStorage\.setItem/);
assert.match(completion, /intent:\/\/auth-callback/);
assert.doesNotMatch(completion, /access_token=[^&`]*|refresh_token=[^&`]*/i);
assert.match(fallback, /Authentication successful/);
assert.match(fallback, /Open DataCube AU/);

assert.match(websiteLogin, /supabase\.auth\.signInWithPassword/);
assert.match(websiteLogin, /supabase\.auth\.signUp/);
assert.match(websiteLogin, /signInWithGoogle/);
assert.match(websiteCallback, /exchangeCodeForSession\(code\)/);
assert.match(websiteCallback, /syncServerAuthSessionCookie\(session\)/);

assert.match(middleware, /isRetiredWebProductPath/);
assert.match(middleware, /\/mobile-app-required/);
assert.match(middleware, /pathname === '\/dashboard\/settings'/);
console.log('PASS mobile website-auth handoff architecture and retired web product routes');
