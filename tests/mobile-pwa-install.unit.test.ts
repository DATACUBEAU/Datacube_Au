import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

let failed = 0;

function readRepoFile(...segments: string[]): string {
  return readFileSync(path.join(process.cwd(), ...segments), 'utf8');
}

async function run(name: string, fn: () => void | Promise<void>) {
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
  await run('mobile and desktop headers both expose the install control when eligible', () => {
    const layout = readRepoFile('src', 'app', 'dashboard', 'dashboard-client-layout.tsx');
    const first = layout.indexOf('<HeaderPwaInstallButton />');
    const last = layout.lastIndexOf('<HeaderPwaInstallButton />');
    assert.ok(first >= 0, 'missing install button');
    assert.ok(last > first, 'expected mobile and desktop install placements');
    assert.match(layout, /md:hidden/);
    assert.match(layout, /md:flex/);
  });

  await run('install controls use real beforeinstallprompt events and never fake prompts', () => {
    for (const componentPath of [
      ['src', 'components', 'header-pwa-install-button.tsx'],
      ['src', 'components', 'pwa-install-button.tsx'],
      ['src', 'components', 'pwa-sidebar-install-button.tsx'],
    ] as const) {
      const source = readRepoFile(...componentPath);
      assert.match(source, /beforeinstallprompt/);
      assert.match(source, /event\.preventDefault\(\)/);
      assert.match(source, /installPrompt\.prompt\(\)/);
      assert.doesNotMatch(source, /new BeforeInstallPromptEvent/);
      assert.doesNotMatch(source, /console\.log/);
    }
  });

  await run('iOS instructions are concise and dismissal is persisted', () => {
    const header = readRepoFile('src', 'components', 'header-pwa-install-button.tsx');
    assert.match(header, /IOS_INSTALL_DISMISSED_KEY/);
    assert.match(header, /Tap Share, then Add to Home Screen\./);
    assert.match(header, /localStorage\.setItem\(IOS_INSTALL_DISMISSED_KEY, 'true'\)/);
    assert.match(header, /iosInstructionsDismissed/);
  });

  await run('install controls are hidden in standalone mode and fit compact headers', () => {
    const header = readRepoFile('src', 'components', 'header-pwa-install-button.tsx');
    assert.match(header, /display-mode: standalone/);
    assert.match(header, /window\.navigator as any\)\.standalone/);
    assert.match(header, /h-9 w-9 shrink-0/);
    assert.match(header, /aria-label="Install DataCube AU"/);
  });

  await run('service worker lifecycle tests remain in place', () => {
    const lifecycle = readRepoFile('tests', 'service-worker-lifecycle.unit.test.ts');
    assert.match(lifecycle, /clientsClaim: false/);
    assert.match(lifecycle, /SKIP_WAITING message never claims clients directly/);
  });

  if (failed > 0) {
    process.exit(1);
  }
}

void main();
