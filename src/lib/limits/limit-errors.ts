export type LimitExceededPayload = {
  code: 'LIMIT_EXCEEDED';
  limit: string;
  current?: number;
  max?: number;
  reset_at?: string | null;
  [key: string]: unknown;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function extractLimitExceededPayload(error: unknown): LimitExceededPayload | null {
  const root = asRecord(error);
  const rootCode = typeof root.code === 'string' ? root.code : '';
  if (rootCode === 'LIMIT_EXCEEDED') {
    return root as unknown as LimitExceededPayload;
  }

  const details = asRecord(root.details);
  const detailsCode = typeof details.code === 'string' ? details.code : '';
  if (detailsCode === 'LIMIT_EXCEEDED') {
    return details as unknown as LimitExceededPayload;
  }

  const nestedError = asRecord(root.error);
  const nestedCode = typeof nestedError.code === 'string' ? nestedError.code : '';
  if (nestedCode === 'LIMIT_EXCEEDED') {
    return nestedError as unknown as LimitExceededPayload;
  }

  return null;
}
