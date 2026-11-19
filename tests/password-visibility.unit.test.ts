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
  await run('PasswordInput toggles between password and text with accessible state', () => {
    const component = readRepoFile('src', 'components', 'ui', 'password-input.tsx');
    assert.match(component, /type=\{isVisible \? 'text' : 'password'\}/);
    assert.match(component, /type="button"/);
    assert.match(component, /aria-label=\{isVisible \? 'Hide password' : 'Show password'\}/);
    assert.match(component, /aria-pressed=\{isVisible\}/);
    assert.match(component, /onClick=\{\(\) => setIsVisible/);
    assert.match(component, /pr-11/);
  });

  await run('website login is Google-only and exposes no email/password registration fields', () => {
    const login = readRepoFile('src', 'app', 'login', 'page.tsx');
    assert.match(login, /signInWithGoogle/);
    assert.match(login, /Continue with Google/);
    assert.doesNotMatch(login, /PasswordInput|signInWithPassword|signUp\(|type="password"|authMode/);
  });

  await run('admin-created user password uses PasswordInput without making provider keys visible', () => {
    const users = readRepoFile('src', 'components', 'admin', 'conex-user-management.tsx');
    const conex = readRepoFile('src', 'app', 'conex', 'page.tsx');
    assert.match(users, /<PasswordInput/);
    assert.match(users, /autoComplete="new-password"/);
    assert.match(conex, /placeholder=\{initialData\?\.configured \? 'Leave blank to keep existing key' : 'sk-\.\.\.'\}/);
    assert.doesNotMatch(conex, /<PasswordInput[\s\S]{0,300}key_value/);
  });

  if (failed > 0) {
    process.exit(1);
  }
}

void main();
