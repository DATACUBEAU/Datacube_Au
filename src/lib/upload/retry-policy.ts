export type UploadErrorLike = {
  status?: number | null;
  code?: string | null;
  message?: string | null;
  details?: any;
};

const NON_RETRYABLE_HTTP_STATUSES = new Set([400, 401, 403, 404, 409, 410, 413, 422, 429]);
const RETRYABLE_ERROR_CODES = new Set([
  'internal_server_error',
  'upstream_timeout',
  'storage_error',
  'server_error',
  'network_error',
]);

function getNestedValue(obj: any, path: string[]): unknown {
  let current = obj;
  for (const key of path) {
    if (!current || typeof current !== 'object') return null;
    current = current[key];
  }
  return current;
}

function firstNonEmptyString(values: unknown[]): string {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return '';
}

function normalizeCode(error: UploadErrorLike | null | undefined): string {
  const code = firstNonEmptyString([
    getNestedValue(error, ['code']),
    getNestedValue(error, ['details', 'code']),
    getNestedValue(error, ['details', 'details', 'code']),
    getNestedValue(error, ['details', 'error', 'code']),
    getNestedValue(error, ['details', 'details', 'error', 'code']),
  ]);
  return String(code).trim().toLowerCase();
}

function normalizeMessage(error: UploadErrorLike | null | undefined): string {
  const message = firstNonEmptyString([
    getNestedValue(error, ['message']),
    getNestedValue(error, ['details', 'message']),
    getNestedValue(error, ['details', 'error']),
    getNestedValue(error, ['details', 'details', 'message']),
    getNestedValue(error, ['details', 'details', 'error']),
    getNestedValue(error, ['details', 'error', 'message']),
    getNestedValue(error, ['details', 'details', 'error', 'message']),
  ]);
  return message.toLowerCase();
}

function normalizeDetailsText(error: UploadErrorLike | null | undefined): string {
  const details = error?.details;
  if (!details) return '';

  if (typeof details === 'string') return details.trim().toLowerCase();

  try {
    return JSON.stringify(details).toLowerCase();
  } catch {
    return '';
  }
}

function isSchemaCompatibilityError(code: string, message: string, detailsText: string): boolean {
  if (code === 'schema_mismatch' || code === 'db_migration_required') return true;
  if (message.includes('database schema mismatch')) return true;
  if (message.includes('apply latest migrations')) return true;
  if (message.includes('required upload finalize rpc is missing')) return true;
  if (detailsText.includes('database schema mismatch')) return true;
  if (detailsText.includes('apply latest migrations')) return true;
  if (detailsText.includes('required upload finalize rpc is missing')) return true;
  if (detailsText.includes('"code":"schema_mismatch"')) return true;
  if (detailsText.includes('"code":"db_migration_required"')) return true;
  return false;
}

export function isRetryableUploadError(error: UploadErrorLike | null | undefined): boolean {
  const status = Number(error?.status ?? 0);
  const code = normalizeCode(error);
  const message = normalizeMessage(error);
  const detailsText = normalizeDetailsText(error);

  if (isSchemaCompatibilityError(code, message, detailsText)) return false;

  if (Number.isFinite(status) && status >= 500) return true;
  if (NON_RETRYABLE_HTTP_STATUSES.has(status)) return false;

  if (code && RETRYABLE_ERROR_CODES.has(code)) return true;
  if (code && code.includes('timeout')) return true;

  if (message.includes('network error')) return true;
  if (message.includes('failed to fetch')) return true;
  if (message.includes('upstream_timeout')) return true;
  if (message.includes('internal_server_error')) return true;
  if (message.includes('storage_error')) return true;

  return false;
}
