const SENSITIVE_KEY_PATTERN = /(authorization|cookie|set-cookie|apikey|api[_-]?key|secret|token|jwt|service[_-]?role|shared[_-]?secret|password|credential)/i;
const SECRET_VALUE_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  /\bsk-[A-Za-z0-9_-]{12,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  /\bsb_secret_[A-Za-z0-9_-]{8,}/gi,
];

function redactString(value: string): string {
  let output = value;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    output = output.replace(pattern, '[REDACTED]');
  }
  return output;
}

export function redactForLog(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      code: (value as any).code,
      status: (value as any).status,
      statusCode: (value as any).statusCode,
      provider: (value as any).provider,
    };
  }
  if (Array.isArray(value)) {
    if (depth > 4) return '[REDACTED_DEPTH]';
    return value.map((entry) => redactForLog(entry, depth + 1));
  }
  if (typeof value === 'object') {
    if (depth > 4) return '[REDACTED_DEPTH]';
    const sanitized: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      sanitized[key] = SENSITIVE_KEY_PATTERN.test(key) ? '[REDACTED]' : redactForLog(entry, depth + 1);
    }
    return sanitized;
  }
  return '[UNLOGGABLE]';
}

function sanitizeArgs(args: unknown[]): unknown[] {
  return args.map((arg) => redactForLog(arg));
}

export const logger = {
  info: (msg: string, ...args: any[]) => console.log(`[INFO] ${new Date().toISOString()} ${redactString(msg)}`, ...sanitizeArgs(args)),
  warn: (msg: string, ...args: any[]) => console.warn(`[WARN] ${new Date().toISOString()} ${redactString(msg)}`, ...sanitizeArgs(args)),
  error: (msg: string, ...args: any[]) => console.error(`[ERROR] ${new Date().toISOString()} ${redactString(msg)}`, ...sanitizeArgs(args)),
  debug: (msg: string, ...args: any[]) => {
    if (process.env.DEBUG === '1') console.log(`[DEBUG] ${new Date().toISOString()} ${redactString(msg)}`, ...sanitizeArgs(args));
  },
};

export function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw ?? '');
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

export function clampPositiveInt(raw: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(raw ?? '');
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

export function firstEnv(...keys: string[]): string | null {
  for (const key of keys) {
    const value = process.env[key];
    if (value && value.trim().length > 0) return value;
  }
  return null;
}

export function getOpenRouterKey(): string | null {
  return firstEnv('OPENROUTER_API_KEY', 'OPENAI_API_KEY');
}

export function getAnthropicKey(): string | null {
  return firstEnv('ANTHROPIC_API_KEY');
}

export async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class GatewayProviderError extends Error {
  constructor(
    readonly provider: string,
    readonly statusCode: number,
    message = 'AI provider request failed',
  ) {
    super(message);
    this.name = 'GatewayProviderError';
  }
}

export function publicErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof GatewayProviderError) {
    return 'AI provider request failed. Please try again.';
  }
  const message = error instanceof Error ? error.message : String(error || '');
  if (/API_KEY|not configured|missing/i.test(message)) {
    return 'AI provider is not configured.';
  }
  return fallback;
}

export function errorLogDetails(error: unknown): unknown {
  return redactForLog(error);
}
