import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function run(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error: any) {
    console.error(`FAIL ${name}`);
    console.error(error?.stack || error);
    process.exitCode = 1;
  }
}

run('AU onboarding contains page-specific guidance for major routes', () => {
  const source = readRepoFile('src/components/au-assistant.tsx');
  const routes = [
    '/dashboard',
    '/dashboard/chat',
    '/dashboard/global-chat',
    '/dashboard/documents',
    '/dashboard/knowledge',
    '/dashboard/practice',
    '/dashboard/predictions',
    '/dashboard/settings',
    '/dashboard/settings/subscription',
    '/conex',
    '/conex/users',
    '/conex/plan-limits',
    '/pricing',
    '/login',
  ];

  for (const route of routes) {
    assert.match(source, new RegExp(`['"]${route.replace(/\//g, '\\/')}['"]`), route);
  }

  assert.match(source, /actions:\s*\[/);
  assert.doesNotMatch(source, /How can I help\?/);
  assert.doesNotMatch(source, /provider key|service-role|VPS_SHARED_SECRET|Authorization header/i);
});

run('AU assistant is globally mounted once and keeps page dismissal scoped', () => {
  const rootLayout = readRepoFile('src/app/layout.tsx');
  const dashboardLayout = readRepoFile('src/app/dashboard/dashboard-client-layout.tsx');
  const assistant = readRepoFile('src/components/au-assistant.tsx');

  assert.match(rootLayout, /<AUAssistant \/>/);
  assert.doesNotMatch(dashboardLayout, /<AUAssistant \/>/);
  assert.match(assistant, /au_assistant_dismissed_/);
  assert.match(assistant, /pageStoragePath\(pathname\)/);
  assert.match(assistant, /assistantScope = user\?\.id \|\| 'guest'/);
  assert.match(assistant, /aria-expanded=\{isExpanded\}/);
  assert.match(assistant, /aria-live="polite"/);
});

run('AU onboarding is optional, versioned, dismissible, and respects cooldown', () => {
  const assistant = readRepoFile('src/components/au-assistant.tsx');
  assert.match(assistant, /ONBOARDING_VERSION/);
  assert.match(assistant, /ONBOARDING_MAYBE_LATER_COOLDOWN_MS = 7 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(assistant, /Would you like a quick guided tour of DataCube AU\?/);
  assert.match(assistant, /Start tour/);
  assert.match(assistant, /Maybe later/);
  assert.match(assistant, /Skip tour/);
  assert.match(assistant, /completedAt/);
  assert.match(assistant, /skippedAt/);
  assert.match(assistant, /maybeLaterAt/);
  assert.match(assistant, /hasLegacyAssistantActivity/);
  assert.doesNotMatch(assistant, /setIsExpanded\(!dismissed\)/);
});

run('AU onboarding does not show over auth or expired-session routes', () => {
  const assistant = readRepoFile('src/components/au-assistant.tsx');
  assert.match(assistant, /shouldSuppressOnboardingForPath/);
  assert.match(assistant, /startsWith\('\/login'\)/);
  assert.match(assistant, /startsWith\('\/signup'\)/);
  assert.match(assistant, /startsWith\('\/auth\/callback'\)/);
  assert.match(assistant, /startsWith\('\/session-expired'\)/);
  assert.match(assistant, /runtimeAuthState === 'RESTORING'/);
  assert.match(assistant, /runtimeAuthState === 'EXPIRED'/);
});

run('manual Help guide can restart the product tour', () => {
  const guide = readRepoFile('src/components/site-manual-guide.tsx');
  const assistant = readRepoFile('src/components/au-assistant.tsx');
  assert.match(guide, /START_PRODUCT_TOUR_EVENT/);
  assert.match(guide, /Take a product tour/);
  assert.match(guide, /window\.dispatchEvent\(new CustomEvent\(START_PRODUCT_TOUR_EVENT\)\)/);
  assert.match(assistant, /localStorage\.setItem\(settingsKey, 'enabled'\)/);
  assert.match(assistant, /detail: \{ enabled: true \}/);
});

run('AU assistant and shared dialogs use small-screen safe dimensions', () => {
  const assistant = readRepoFile('src/components/au-assistant.tsx');
  const dialog = readRepoFile('src/components/ui/dialog.tsx');
  const alertDialog = readRepoFile('src/components/ui/alert-dialog.tsx');

  assert.match(assistant, /inset-x-3/);
  assert.match(assistant, /env\(safe-area-inset-bottom\)/);
  assert.match(assistant, /max-w-\[calc\(100vw-1\.5rem\)\]/);
  assert.match(assistant, /max-h-\[min\(70dvh,26rem\)\]/);
  assert.match(dialog, /w-\[calc\(100vw-1\.5rem\)\]/);
  assert.match(dialog, /max-h-\[calc\(100dvh-2rem\)\]/);
  assert.match(dialog, /overflow-y-auto/);
  assert.match(alertDialog, /w-\[calc\(100vw-1\.5rem\)\]/);
  assert.match(alertDialog, /max-h-\[calc\(100dvh-2rem\)\]/);
  assert.match(alertDialog, /overflow-y-auto/);
});

run('core dashboard and Conex layouts avoid fixed mobile two-column overflow', () => {
  const dashboardLayout = readRepoFile('src/app/dashboard/dashboard-client-layout.tsx');
  const conex = readRepoFile('src/app/conex/page.tsx');

  assert.match(dashboardLayout, /overflow-x-hidden/);
  assert.match(dashboardLayout, /min-w-0 flex-1/);
  assert.match(conex, /grid grid-cols-1 gap-4 sm:grid-cols-2/);
  assert.match(conex, /className="min-w-0"/);
  assert.match(conex, /flex flex-wrap items-center gap-2/);
});
