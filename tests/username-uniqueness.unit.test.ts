import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

let failed = 0;

type TestFn = () => void | Promise<void>;

function readRepoFile(...segments: string[]): string {
  return readFileSync(path.join(process.cwd(), ...segments), 'utf8');
}

async function run(name: string, fn: TestFn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error: any) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error?.stack || error);
  }
}

function normalizeUsername(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

async function main() {
  await run('username normalization trims and lowercases', () => {
    assert.equal(normalizeUsername(' Kingsley '), 'kingsley');
    assert.equal(normalizeUsername(' KINGSLEY '), 'kingsley');
  });

  await run('migration adds normalized username columns and duplicate preflight', () => {
    const migrationPath = path.join(process.cwd(), 'supabase', 'migrations', '20260729153000_username_uniqueness.sql');
    assert.equal(existsSync(migrationPath), true);
    const migration = readFileSync(migrationPath, 'utf8');
    assert.match(migration, /add column if not exists username text/i);
    assert.match(migration, /add column if not exists username_normalized text/i);
    assert.match(migration, /username_normalized_duplicates_detected/i);
    assert.match(migration, /count\(\*\)/i);
    assert.doesNotMatch(migration, /select\s+.*email/i);
    assert.match(migration, /create unique index if not exists au_user_profiles_username_normalized_uidx/i);
    assert.match(migration, /where username_normalized is not null/i);
    assert.match(migration, /before insert or update of username, username_normalized/i);
  });

  await run('auth trigger stores username metadata without overwriting existing username', () => {
    const migration = readRepoFile('supabase', 'migrations', '20260729153000_username_uniqueness.sql');
    assert.match(migration, /new\.raw_user_meta_data->>'username'/i);
    assert.match(migration, /username = coalesce\(public\.au_user_profiles\.username, excluded\.username\)/i);
    assert.match(migration, /username_normalized = coalesce\(public\.au_user_profiles\.username_normalized, excluded\.username_normalized\)/i);
  });

  await run('signup requires username and performs availability check before signUp', () => {
    const login = readRepoFile('src', 'app', 'login', 'page.tsx');
    assert.match(login, /const \[username, setUsername\]/);
    assert.match(login, /validateUsername\(username\)/);
    assert.match(login, /\/api\/profile\/username\?username=/);
    assert.match(login, /USERNAME_TAKEN_MESSAGE/);
    assert.match(login, /username: normalizedUsername/);
    assert.match(login, /disabled=\{isLoadingEmail \|\| !email\.trim\(\) \|\| !password \|\| \(authMode === 'signup' && !username\.trim\(\)\)\}/);
  });

  await run('profile username API returns safe DTOs only', () => {
    const route = readRepoFile('src', 'app', 'api', 'profile', 'username', 'route.ts');
    assert.match(route, /select\('user_id', \{ count: 'exact', head: true \}\)/);
    assert.match(route, /select\('username, username_normalized'\)/);
    assert.match(route, /available/);
    assert.match(route, /needsUsername/);
    assert.doesNotMatch(route, /email|full_name|avatar_url|select\('\*'\)/);
    assert.doesNotMatch(route, /console\.(log|info|warn|error)/);
  });

  await run('OAuth users without username get profile completion guidance', () => {
    const settings = readRepoFile('src', 'app', 'dashboard', 'settings', 'page.tsx');
    const assistant = readRepoFile('src', 'components', 'au-assistant.tsx');
    assert.match(settings, /Choose a unique username to complete your profile\./);
    assert.match(settings, /\/api\/profile\/username/);
    assert.match(assistant, /Google users can finish username setup from profile settings/);
  });

  if (failed > 0) {
    process.exit(1);
  }
}

void main();
