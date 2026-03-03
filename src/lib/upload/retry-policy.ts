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

function normalizeCode(error: UploadErrorLike | null | undefined): string {
  const nestedCode = typeof error?.details?.code === 'string' ? error?.details?.code : null;
  const directCode = typeof error?.code === 'string' ? error?.code : null;
  const code = nestedCode || directCode || '';
  return String(code).trim().toLowerCase();
}

function normalizeMessage(error: UploadErrorLike | null | undefined): string {
  return String(error?.message || '').trim().toLowerCase();
}

export function isRetryableUploadError(error: UploadErrorLike | null | undefined): boolean {
  const status = Number(error?.status ?? 0);
  const code = normalizeCode(error);
  const message = normalizeMessage(error);

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
