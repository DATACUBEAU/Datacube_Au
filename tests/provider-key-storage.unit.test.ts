import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  decryptProviderKey,
  encryptProviderKey,
  isEncryptedProviderKeyValue,
  providerKeyFingerprint,
  providerKeyLast4,
} from '../src/lib/server/provider-key-encryption.js';

const repoRoot = process.cwd();
const testEnv = {
  PROVIDER_KEY_ENCRYPTION_SECRET: 'unit-test-provider-key-secret-32-bytes-minimum',
};

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

run('provider key encryption round-trips without exposing plaintext in the stored value', () => {
  const rawKey = 'provider-key-for-unit-test-only';
  const encrypted = encryptProviderKey(rawKey, testEnv);

  assert.equal(isEncryptedProviderKeyValue(encrypted), true);
  assert.notEqual(encrypted, rawKey);
  assert.equal(encrypted.includes(rawKey), false);
  assert.equal(decryptProviderKey(encrypted, testEnv), rawKey);
  assert.equal(providerKeyLast4(rawKey), 'only');
  assert.match(providerKeyFingerprint(rawKey), /^[a-f0-9]{64}$/);
});

run('admin provider-key create and update encrypt before storage and return masked DTOs only', () => {
  const handler = readRepoFile('src/app/api/admin/handler/route.ts');
  const publicColumns = handler.match(/const PROVIDER_KEY_PUBLIC_COLUMNS =\s*\n\s*'([^']+)'/)?.[1] || '';

  assert.match(handler, /encryptProviderKey\(newKeyValue\)/);
  assert.match(handler, /payload\.encrypted_key_value/);
  assert.match(handler, /payload\.key_encryption_version = 'app_aes_256_gcm_v1'/);
  assert.match(handler, /payload\.key_value = null/);
  assert.match(handler, /providerKeyLast4\(newKeyValue\)/);
  assert.match(handler, /providerKeyFingerprint\(newKeyValue\)/);
  assert.match(handler, /\.select\(PROVIDER_KEY_PUBLIC_COLUMNS\)/);
  assert.match(handler, /sanitizeProviderKeyRow\(data\)/);
  assert.doesNotMatch(publicColumns, /key_value|encrypted_key_value|key_reference|key_encryption_version/);
  assert.doesNotMatch(handler, /\{\s*ok:\s*true,\s*key:\s*data/);
});

run('provider-key revoke clears raw and encrypted server-side credential fields', () => {
  const handler = readRepoFile('src/app/api/admin/handler/route.ts');

  assert.match(handler, /key_value:\s*null/);
  assert.match(handler, /encrypted_key_value:\s*null/);
  assert.match(handler, /key_encryption_version:\s*null/);
  assert.match(handler, /key_encrypted_at:\s*null/);
  assert.match(handler, /key_reference:\s*null/);
});

run('server AI routing decrypts provider keys server-side and rejects invalid encrypted payloads', () => {
  const routing = readRepoFile('src/lib/server/ai-routing.ts');

  assert.match(routing, /decryptProviderKey\(encryptedKeyValue\)/);
  assert.match(routing, /isEncryptedProviderKeyValue\(encryptedKeyValue\)/);
  assert.match(routing, /provider_key_decrypt_failed/);
  assert.match(routing, /\.select\('service,key_value,encrypted_key_value,key_encryption_version/);
  assert.doesNotMatch(routing, /console\.log\([^)]*keyValue/);
  assert.doesNotMatch(routing, /logger\.[a-z]+\([^)]*keyValue/);
});

run('migration adds encrypted credential metadata without destructive SQL', () => {
  const sql = readRepoFile('supabase/migrations/20260729120000_provider_key_encryption_columns.sql');

  assert.match(sql, /add column if not exists encrypted_key_value text/i);
  assert.match(sql, /add column if not exists key_encryption_version text/i);
  assert.match(sql, /add column if not exists key_encrypted_at timestamptz/i);
  assert.match(sql, /add column if not exists key_reference text/i);
  assert.match(sql, /revoke all on table public\.%I from anon, authenticated/i);
  assert.match(sql, /grant all on table public\.%I to service_role/i);
  assert.doesNotMatch(sql, /\bDROP\s+TABLE\b|\bTRUNCATE\b|\bDELETE\s+FROM\b|\bRESET\b/i);
});
