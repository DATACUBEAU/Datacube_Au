export type LimitExceededPayload = {
  code: 'LIMIT_EXCEEDED' | 'LIMIT_REACHED' | 'PRO_REQUIRED';
  limit?: string;
  key?: string;
  current?: number;
  used?: number;
  max?: number;
  message?: string;
  upgrade?: {
    cta?: string;
    href?: string;
  };
  reset_at?: string | null;
  [key: string]: unknown;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function extractLimitExceededPayload(error: unknown): LimitExceededPayload | null {
  const root = asRecord(error);
  const candidates = [root, asRecord(root.details), asRecord(root.error)];

  for (const candidate of candidates) {
    const explicitCode = typeof candidate.code === 'string' ? candidate.code : '';
    const errorAsCode = typeof candidate.error === 'string' ? candidate.error : '';
    const code = explicitCode || errorAsCode;
    if (!['LIMIT_EXCEEDED', 'LIMIT_REACHED', 'PRO_REQUIRED'].includes(code)) continue;

    const normalized: LimitExceededPayload = {
      ...(candidate as LimitExceededPayload),
      code: code as LimitExceededPayload['code'],
    };

    if (!normalized.limit && typeof candidate.key === 'string') {
      normalized.limit = candidate.key;
    }
    if (!normalized.key && typeof candidate.limit === 'string') {
      normalized.key = candidate.limit;
    }
    if (typeof normalized.current !== 'number' && typeof candidate.used === 'number') {
      normalized.current = candidate.used;
    }
    if (typeof normalized.max !== 'number' && typeof candidate.limit === 'number') {
      normalized.max = candidate.limit;
    }

    return normalized;
  }

  return null;
}
