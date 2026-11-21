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
const androidGradle = read('apps', 'android', 'app', 'build.gradle.kts');
const androidManifest = read('apps', 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
const androidActivity = read('apps', 'android', 'app', 'src', 'main', 'java', 'au', 'datacube', 'app', 'MainActivity.kt');
const androidViewModel = read('apps', 'android', 'app', 'src', 'main', 'java', 'au', 'datacube', 'app', 'ui', 'auth', 'AuthViewModel.kt');
const androidLogo = readFileSync('apps/android/app/src/main/res/drawable-nodpi/datacube_logo.png');
const picker = read('apps', 'android', 'app', 'src', 'main', 'java', 'au', 'datacube', 'app', 'auth', 'GoogleAccountPicker.kt');
const launcherIcon = read('apps', 'android', 'app', 'src', 'main', 'res', 'mipmap-anydpi-v26', 'ic_launcher.xml');
const profileScreen = read('apps', 'android', 'app', 'src', 'main', 'java', 'au', 'datacube', 'app', 'ui', 'profile', 'ProfileScreen.kt');
const websiteLogin = read('src', 'app', 'login', 'page.tsx');
const websiteAuthHook = read('src', 'hooks', 'use-smart-auth.tsx');
const websiteSettings = read('src', 'app', 'dashboard', 'settings', 'page.tsx');
const websiteLayout = read('src', 'app', 'layout.tsx');
const websiteManifest = read('src', 'app', 'manifest.ts');
const brandIcon = read('public', 'icon.svg');
const middleware = read('src', 'middleware.ts');

assert.match(androidAuthScreen, /Continue with Google/);
assert.match(androidAuthScreen, /CredentialManager/);
assert.match(picker, /GetSignInWithGoogleOption/);
assert.match(picker, /GetSignInWithGoogleOption\.Builder\(BuildConfig\.GOOGLE_WEB_CLIENT_ID\)/);
assert.match(picker, /GoogleIdTokenCredential\.createFrom/);
assert.match(picker, /GetCredentialCancellationException/);
assert.match(androidAuthScreen, /signInWithGoogle/);
assert.doesNotMatch(androidAuthScreen, /onOpenWebsite|createWebsiteLoginUrl|mobile-handoff|AUTH_WEBSITE_URL/);

assert.match(androidGradle, /GOOGLE_WEB_CLIENT_ID/);
assert.match(androidGradle, /libs\.credentials/);
assert.match(androidGradle, /libs\.googleid/);
assert.match(androidGradle, /local\.properties/);
assert.match(androidGradle, /NEXT_PUBLIC_SUPABASE_URL/);
assert.match(androidGradle, /NEXT_PUBLIC_SUPABASE_ANON_KEY/);
assert.match(androidGradle, /GradleException/);

assert.match(androidRepository, /providers\.builtin\.IDToken/);
assert.match(androidRepository, /signInWith\(IDToken\)/);
assert.match(androidRepository, /provider = Google/);
assert.match(androidRepository, /idToken = idToken/);
assert.match(androidRepository, /nonce = rawNonce/);
assert.match(picker, /setNonce\(googleNonceDigest\(rawNonce\)\)/);
assert.match(androidRepository, /clearCredentialState\(ClearCredentialStateRequest\(\)\)/);
assert.match(androidRepository, /sessionStore\.persist\(user\)/);
assert.match(androidRepository, /restoreSession/);
assert.match(androidRepository, /signOut\(\)/);
assert.doesNotMatch(androidRepository, /AUTH_WEBSITE_URL|mobile-handoff|HttpClient|PendingMobileAuthStore/);

assert.match(androidManifest, /android:icon="@mipmap\/ic_launcher"/);
assert.match(androidManifest, /android:roundIcon="@mipmap\/ic_launcher_round"/);
assert.doesNotMatch(androidManifest, /auth-callback/);
assert.doesNotMatch(androidActivity, /handleAuthIntent|completeWebsiteAuthentication|createWebsiteLoginUrl/);
assert.match(androidViewModel, /signInWithGoogle/);
assert.match(androidViewModel, /restoreSession/);

assert.deepEqual(androidLogo, Buffer.from(brandIcon.match(/data:image\/png;base64,([^"]+)/)![1], 'base64'));
assert.match(launcherIcon, /@drawable\/datacube_logo/);
assert.match(profileScreen, /R\.drawable\.datacube_logo/);
assert.match(androidAuthScreen, /R\.drawable\.datacube_logo/);

assert.match(websiteLogin, /signInWithGoogle/);
assert.match(websiteAuthHook, /provider:\s*'google'/);
assert.match(websiteSettings, /Icons\.logo/);
assert.match(websiteLayout, /icon: '\/icon\.svg'/);
assert.match(websiteManifest, /icon\.svg/);
assert.match(brandIcon, /DataCube AU/);
assert.match(brandIcon, /data:image\/png;base64,/);

assert.match(route, /requireUserFromRequest\(request\)/);
assert.match(route, /auth\.admin\.generateLink/);
assert.match(route, /aes-256-gcm/);
assert.match(route, /Cache-Control.*no-store/s);
assert.doesNotMatch(route, /console\.(log|info|warn|error)\([^)]*(access_token|refresh_token|Authorization)/i);
assert.match(migration, /enable row level security/i);
assert.match(migration, /revoke all on table public\.au_mobile_auth_handoffs from public, anon, authenticated/i);
assert.match(completion, /action: 'issue'/);
assert.match(completion, /codeChallenge/);
assert.match(fallback, /intentUrl && !appMissing/);
assert.match(middleware, /isRetiredWebProductPath/);

console.log('PASS native Android Google auth, isolated legacy handoff compatibility, and DataCube AU cube branding');
