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
const androidHomeScreen = read('apps', 'android', 'app', 'src', 'main', 'java', 'au', 'datacube', 'app', 'ui', 'home', 'HomeScreen.kt');
const approvalScreen = read('src', 'app', 'mobile-auth', 'approve', 'page.tsx');
const androidLogo = readFileSync('apps/android/app/src/main/res/drawable-nodpi/datacube_logo.png');
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
assert.match(androidAuthScreen, /Copy code/);
assert.match(androidAuthScreen, /LocalClipboardManager/);
assert.match(approvalScreen, /Go to your DataCube AU app/);
assert.match(approvalScreen, /Copy code/);
assert.doesNotMatch(androidActivity, /NavigationBarItem|bottomNavItems/);
assert.ok(!androidActivity.includes('Screen.Study') && !androidActivity.includes('Screen.Chat'));
assert.match(androidHomeScreen, /BasicTextField/);
assert.match(androidHomeScreen, /Upload a document to start asking/);
assert.ok(profileScreen.includes('Text("Settings"'));
assert.match(profileScreen, /SettingsEntry\(Icons\.Outlined\.PersonOutline,\s*"Profile"/);
assert.match(androidAuthScreen, /startMobileSignIn/);
assert.doesNotMatch(androidAuthScreen, /Use Google on this device|viewModel\.signInWithGoogle/);
assert.doesNotMatch(androidActivity, /CredentialManager|getCredential/);
assert.doesNotMatch(androidRepository, /signInWith\(IDToken\)|providers\.Google/);
assert.doesNotMatch(androidGradle, /GOOGLE_WEB_CLIENT_ID|libs\.googleid|libs\.credentials/);
assert.match(androidGradle, /NEXT_PUBLIC_SUPABASE_URL/);
assert.match(androidGradle, /NEXT_PUBLIC_SUPABASE_ANON_KEY/);
assert.match(androidGradle, /GradleException/);
assert.match(androidRepository, /completeMobileSignIn/);
assert.match(androidRepository, /restoreSession/);
assert.match(androidRepository, /signOut\(\)/);
assert.match(androidManifest, /android:icon="@mipmap\/ic_launcher"/);
assert.match(androidManifest, /android:roundIcon="@mipmap\/ic_launcher_round"/);
assert.doesNotMatch(androidManifest, /auth-callback/);
assert.match(androidManifest, /android:autoVerify="true"/);
assert.match(androidManifest, /android:scheme="https"/);
assert.match(androidManifest, /android:host="datacube-au.vercel.app"/);
assert.match(androidManifest, /android:path="\/mobile-auth\/return"/);
assert.doesNotMatch(androidActivity, /handleAuthIntent|completeWebsiteAuthentication|createWebsiteLoginUrl/);
assert.match(androidViewModel, /startMobileSignIn/);
assert.doesNotMatch(androidViewModel, /signInWithGoogle|chooseGoogleAccount/);
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

console.log('PASS browser-only Android auth, verified App Link declaration, legacy handoff compatibility, and DataCube AU cube branding');
