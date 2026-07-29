import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const ENCRYPTION_PREFIX = 'dcau-pk-v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

export type ProviderKeyEncryptionEnv =
  Partial<Record<'PROVIDER_KEY_ENCRYPTION_SECRET', string | undefined>> &
  Record<string, string | undefined>;

function base64UrlEncode(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(value: string): Buffer {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
  return Buffer.from(padded, 'base64');
}

function resolveEncryptionSecret(env: ProviderKeyEncryptionEnv = process.env): string {
  const secret = String(env.PROVIDER_KEY_ENCRYPTION_SECRET || '').trim();
  if (secret.length < 32) {
    throw new Error('PROVIDER_KEY_ENCRYPTION_SECRET is required for provider key encryption.');
  }
  return secret;
}

function deriveKey(secret: string): Buffer {
  return createHash('sha256').update(secret, 'utf8').digest();
}

export function isEncryptedProviderKeyValue(value: unknown): boolean {
  return String(value || '').startsWith(`${ENCRYPTION_PREFIX}:`);
}

export function encryptProviderKey(rawKey: string, env: ProviderKeyEncryptionEnv = process.env): string {
  const plaintext = String(rawKey || '').trim();
  if (!plaintext) {
    throw new Error('Provider key value is required.');
  }

  const key = deriveKey(resolveEncryptionSecret(env));
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(ENCRYPTION_PREFIX, 'utf8'));
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    ENCRYPTION_PREFIX,
    base64UrlEncode(iv),
    base64UrlEncode(tag),
    base64UrlEncode(encrypted),
  ].join(':');
}

export function decryptProviderKey(encryptedValue: string, env: ProviderKeyEncryptionEnv = process.env): string {
  const value = String(encryptedValue || '').trim();
  const parts = value.split(':');
  if (parts.length !== 4 || parts[0] !== ENCRYPTION_PREFIX) {
    throw new Error('Invalid encrypted provider key format.');
  }

  const iv = base64UrlDecode(parts[1]);
  const tag = base64UrlDecode(parts[2]);
  const encrypted = base64UrlDecode(parts[3]);
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES || encrypted.length === 0) {
    throw new Error('Invalid encrypted provider key payload.');
  }

  const key = deriveKey(resolveEncryptionSecret(env));
  const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  decipher.setAAD(Buffer.from(ENCRYPTION_PREFIX, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

export function providerKeyFingerprint(rawKey: string): string {
  return createHash('sha256').update(String(rawKey || '').trim()).digest('hex');
}

export function providerKeyLast4(rawKey: string): string {
  return String(rawKey || '').trim().slice(-4);
}

export function providerKeyMatchesFingerprint(rawKey: string, fingerprint: string | null | undefined): boolean {
  const expected = String(fingerprint || '').trim();
  if (!expected) return false;
  const actual = providerKeyFingerprint(rawKey);
  const actualBuffer = Buffer.from(actual, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(actualBuffer, expectedBuffer);
}
