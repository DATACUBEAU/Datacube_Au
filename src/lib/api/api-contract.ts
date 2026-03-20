type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function pickNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function pickBoolean(...values: unknown[]): boolean | undefined {
  for (const value of values) {
    if (typeof value === 'boolean') {
      return value;
    }
  }
  return undefined;
}

function maybeParseJsonString(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  if (!/^(?:\{|\[|"|-?\d|true|false|null)/i.test(trimmed)) {
    return value;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

export function normalizeApiErrorCode(value: unknown, fallback = 'INTERNAL_SERVER_ERROR'): string {
  const raw = String(value || '').trim();
  if (!raw) return fallback;

  const normalized = raw
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();

  return normalized || fallback;
}

export type ApiErrorShape = {
  code: string;
  message: string;
  details?: unknown;
  retryable?: boolean;
  status?: number | null;
  requestId?: string | null;
  correlationId?: string | null;
  retryAfter?: string | number | null;
  isThrottled?: boolean;
  limit?: string | null;
  key?: string | null;
  current?: number | null;
  used?: number | null;
  max?: number | null;
  upgrade?: Record<string, unknown> | null;
  raw?: unknown;
};

export type StructuredApiSuccess<T> = {
  ok: true;
  data: T;
};

export type StructuredApiErrorResponse = {
  ok: false;
  error: Omit<ApiErrorShape, 'raw'>;
  code: string;
  message: string;
  details?: unknown;
  retryable?: boolean;
  status?: number | null;
  requestId?: string | null;
  correlation_id?: string | null;
  retryAfter?: string | number | null;
  isThrottled?: boolean;
  limit?: string | null;
  key?: string | null;
  current?: number | null;
  used?: number | null;
  max?: number | null;
  upgrade?: Record<string, unknown> | null;
  [key: string]: unknown;
};

export function buildApiSuccessBody<T>(data: T): StructuredApiSuccess<T> {
  return {
    ok: true,
    data,
  };
}

export function unwrapApiSuccess<T>(payload: T | StructuredApiSuccess<T>): T {
  if (isRecord(payload) && payload.ok === true && 'data' in payload) {
    return payload.data as T;
  }
  return payload as T;
}

export function buildApiErrorBody(input: {
  code?: string;
  message: string;
  details?: unknown;
  retryable?: boolean;
  status?: number | null;
  requestId?: string | null;
  correlationId?: string | null;
  retryAfter?: string | number | null;
  isThrottled?: boolean;
  limit?: string | null;
  key?: string | null;
  current?: number | null;
  used?: number | null;
  max?: number | null;
  upgrade?: Record<string, unknown> | null;
  extra?: Record<string, unknown>;
}): StructuredApiErrorResponse {
  const code = normalizeApiErrorCode(input.code || input.message);
  const message = pickString(input.message) || 'Unexpected server error';
  const retryable =
    typeof input.retryable === 'boolean'
      ? input.retryable
      : Boolean(input.status === 408 || input.status === 429 || (input.status ?? 0) >= 500);

  const error: Omit<ApiErrorShape, 'raw'> = {
    code,
    message,
    ...(input.details !== undefined ? { details: input.details } : {}),
    retryable,
    ...(input.status != null ? { status: input.status } : {}),
    ...(input.requestId ? { requestId: input.requestId } : {}),
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    ...(input.retryAfter != null ? { retryAfter: input.retryAfter } : {}),
    ...(typeof input.isThrottled === 'boolean' ? { isThrottled: input.isThrottled } : {}),
    ...(input.limit ? { limit: input.limit } : {}),
    ...(input.key ? { key: input.key } : {}),
    ...(input.current != null ? { current: input.current } : {}),
    ...(input.used != null ? { used: input.used } : {}),
    ...(input.max != null ? { max: input.max } : {}),
    ...(input.upgrade ? { upgrade: input.upgrade } : {}),
  };

  return {
    ok: false,
    error,
    code,
    message,
    ...(input.details !== undefined ? { details: input.details } : {}),
    retryable,
    ...(input.status != null ? { status: input.status } : {}),
    ...(input.requestId ? { requestId: input.requestId } : {}),
    ...(input.correlationId ? { correlation_id: input.correlationId } : {}),
    ...(input.retryAfter != null ? { retryAfter: input.retryAfter } : {}),
    ...(typeof input.isThrottled === 'boolean' ? { isThrottled: input.isThrottled } : {}),
    ...(input.limit ? { limit: input.limit } : {}),
    ...(input.key ? { key: input.key } : {}),
    ...(input.current != null ? { current: input.current } : {}),
    ...(input.used != null ? { used: input.used } : {}),
    ...(input.max != null ? { max: input.max } : {}),
    ...(input.upgrade ? { upgrade: input.upgrade } : {}),
    ...(input.extra || {}),
  };
}

export function extractApiError(input: unknown, fallbackMessage = 'Unexpected error'): ApiErrorShape {
  const root = isRecord(input) ? input : {};
  const nestedError = isRecord(root.error) ? root.error : {};
  const parsedRootDetails = maybeParseJsonString(root.details);
  const parsedNestedDetails = maybeParseJsonString(nestedError.details);
  const detailsRecord = isRecord(parsedNestedDetails)
    ? parsedNestedDetails
    : isRecord(parsedRootDetails)
      ? parsedRootDetails
      : {};

  const message =
    pickString(
      nestedError.message,
      root.message,
      typeof root.error === 'string' ? root.error : null,
      typeof parsedNestedDetails === 'string' ? parsedNestedDetails : null,
      typeof parsedRootDetails === 'string' ? parsedRootDetails : null,
      detailsRecord.message,
      typeof detailsRecord.error === 'string' ? detailsRecord.error : null,
      input instanceof Error ? input.message : null,
      typeof input === 'string' ? input : null,
    ) || fallbackMessage;

  const status = pickNumber(
    nestedError.status,
    root.status,
    detailsRecord.status,
    input instanceof Error ? (input as any).status : null,
  );

  const retryable =
    pickBoolean(
      nestedError.retryable,
      root.retryable,
      detailsRecord.retryable,
      input instanceof Error ? (input as any).retryable : undefined,
    ) ?? Boolean(status === 408 || status === 429 || (status ?? 0) >= 500);

  const code = normalizeApiErrorCode(
    pickString(
      nestedError.code,
      root.code,
      detailsRecord.code,
      typeof detailsRecord.error === 'string' ? detailsRecord.error : null,
      input instanceof Error ? (input as any).code : null,
    ) || message,
    'UNEXPECTED_ERROR',
  );

  const requestId = pickString(
    nestedError.requestId,
    nestedError.request_id,
    root.requestId,
    root.request_id,
    detailsRecord.requestId,
    detailsRecord.request_id,
  );

  const correlationId = pickString(
    nestedError.correlationId,
    nestedError.correlation_id,
    root.correlationId,
    root.correlation_id,
    detailsRecord.correlationId,
    detailsRecord.correlation_id,
  );

  const retryAfter =
    pickString(
      nestedError.retryAfter,
      nestedError.retry_after,
      root.retryAfter,
      root.retry_after,
      detailsRecord.retryAfter,
      detailsRecord.retry_after,
    ) ??
    pickNumber(
      nestedError.retryAfter,
      nestedError.retry_after,
      root.retryAfter,
      root.retry_after,
      detailsRecord.retryAfter,
      detailsRecord.retry_after,
    );

  const isThrottled =
    pickBoolean(
      nestedError.isThrottled,
      root.isThrottled,
      detailsRecord.isThrottled,
      input instanceof Error ? (input as any).isThrottled : undefined,
    ) ?? status === 429;

  const limit = pickString(
    nestedError.limit,
    root.limit,
    detailsRecord.limit,
    nestedError.key,
    root.key,
    detailsRecord.key,
  );

  const key = pickString(
    nestedError.key,
    root.key,
    detailsRecord.key,
    limit,
  );

  const current = pickNumber(
    nestedError.current,
    nestedError.used,
    root.current,
    root.used,
    detailsRecord.current,
    detailsRecord.used,
  );

  const used = pickNumber(
    nestedError.used,
    root.used,
    detailsRecord.used,
    current,
  );

  const max = pickNumber(
    nestedError.max,
    root.max,
    detailsRecord.max,
  );

  const upgrade = isRecord(nestedError.upgrade)
    ? nestedError.upgrade
    : isRecord(root.upgrade)
      ? root.upgrade
      : isRecord(detailsRecord.upgrade)
        ? detailsRecord.upgrade
        : null;

  const details = parsedNestedDetails ?? parsedRootDetails;

  return {
    code,
    message,
    ...(details !== undefined ? { details } : {}),
    retryable,
    status,
    requestId,
    correlationId,
    retryAfter,
    isThrottled,
    limit,
    key,
    current,
    used,
    max,
    upgrade,
    raw: input,
  };
}

export class ApiRequestError extends Error {
  status: number | null;
  code: string;
  details: unknown;
  retryable: boolean;
  requestId: string | null;
  correlationId: string | null;
  retryAfter: string | number | null;
  isThrottled: boolean;
  limit: string | null;
  key: string | null;
  current: number | null;
  used: number | null;
  max: number | null;
  upgrade: Record<string, unknown> | null;
  raw: unknown;

  constructor(payload: ApiErrorShape) {
    super(payload.message);
    this.name = 'ApiRequestError';
    this.status = payload.status ?? null;
    this.code = payload.code;
    this.details = payload.details;
    this.retryable = Boolean(payload.retryable);
    this.requestId = payload.requestId ?? null;
    this.correlationId = payload.correlationId ?? null;
    this.retryAfter = payload.retryAfter ?? null;
    this.isThrottled = Boolean(payload.isThrottled);
    this.limit = payload.limit ?? null;
    this.key = payload.key ?? null;
    this.current = payload.current ?? null;
    this.used = payload.used ?? null;
    this.max = payload.max ?? null;
    this.upgrade = payload.upgrade ?? null;
    this.raw = payload.raw;
  }
}

export function toApiRequestError(input: unknown, fallbackMessage = 'Unexpected error'): ApiRequestError {
  if (input instanceof ApiRequestError) {
    return input;
  }

  const extracted = extractApiError(input, fallbackMessage);
  const error = new ApiRequestError(extracted);
  if (input instanceof Error && input.stack) {
    error.stack = input.stack;
  }
  return error;
}

export function extractApiErrorMessage(input: unknown, fallbackMessage = 'Unexpected error'): string {
  return extractApiError(input, fallbackMessage).message;
}
