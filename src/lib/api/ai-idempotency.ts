const SAFE_PREFIX_PATTERN = /[^A-Za-z0-9_-]+/g;

export function createAiIdempotencyKey(prefix: string): string {
  const safePrefix = String(prefix || 'ai').replace(SAFE_PREFIX_PATTERN, '_').slice(0, 40) || 'ai';
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${safePrefix}_${crypto.randomUUID()}`;
  }
  const random = Math.random().toString(36).slice(2, 14);
  return `${safePrefix}_${Date.now()}_${random}`;
}
