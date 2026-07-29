export const USERNAME_TAKEN_MESSAGE = 'That username is already taken. Choose another one.';

const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{1,28}[a-z0-9])?$/;

export function normalizeUsername(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

export function validateUsername(value: unknown): {
  ok: boolean;
  normalized: string;
  message?: string;
} {
  const normalized = normalizeUsername(value);
  if (!normalized) {
    return {
      ok: false,
      normalized,
      message: 'Choose a username to continue.',
    };
  }
  if (normalized.length < 3 || normalized.length > 30 || !USERNAME_PATTERN.test(normalized)) {
    return {
      ok: false,
      normalized,
      message: 'Use 3-30 letters, numbers, dots, dashes, or underscores.',
    };
  }
  return { ok: true, normalized };
}

export function isUsernameTakenError(error: unknown): boolean {
  const code = String((error as any)?.code || '').toLowerCase();
  const message = String((error as any)?.message || (error as any)?.error_description || error || '').toLowerCase();
  return (
    code === '23505' ||
    message.includes('username') && (
      message.includes('duplicate') ||
      message.includes('unique') ||
      message.includes('already') ||
      message.includes('taken')
    )
  );
}
