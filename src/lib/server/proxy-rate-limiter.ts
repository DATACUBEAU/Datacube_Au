/**
 * Lightweight in-memory sliding-window rate limiter for proxy requests.
 *
 * No external dependencies — uses a simple Map with periodic cleanup.
 * Limits are applied per-user AND per-IP to cover both authenticated abuse
 * and credential sharing / botnet spraying.
 *
 * Design:
 *   - Sliding window: counts requests in the last `windowMs` milliseconds.
 *   - Per-key buckets: each key (userId or IP) gets its own timestamp array.
 *   - Auto-cleanup: stale buckets are purged every `CLEANUP_INTERVAL_MS`.
 *   - Zero allocation on the hot path when under limit (array push only).
 */

// ---------------------------------------------------------------------------
// Configuration (env-overridable)
// ---------------------------------------------------------------------------

function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/** Max requests per user within the sliding window. */
const USER_RATE_LIMIT = envInt('PROXY_USER_RATE_LIMIT', 30);
/** Max requests per IP within the sliding window. */
const IP_RATE_LIMIT = envInt('PROXY_IP_RATE_LIMIT', 60);
/** Sliding window size in milliseconds (default: 60s). */
const WINDOW_MS = envInt('PROXY_RATE_WINDOW_MS', 60_000);
/** Short burst window (default: 5s). */
const BURST_WINDOW_MS = envInt('PROXY_BURST_WINDOW_MS', 5_000);
/** Max requests per user in the burst window (default: 8). */
const BURST_LIMIT = envInt('PROXY_BURST_LIMIT', 8);
/** Interval for purging stale buckets (2 minutes). */
const CLEANUP_INTERVAL_MS = 120_000;

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

const userBuckets = new Map<string, number[]>();
const ipBuckets = new Map<string, number[]>();
let lastCleanup = Date.now();

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

function pruneWindow(timestamps: number[], windowMs: number, now: number): number[] {
  // Find the first index still within the window
  let i = 0;
  while (i < timestamps.length && timestamps[i] < now - windowMs) i++;
  if (i > 0) timestamps.splice(0, i);
  return timestamps;
}

function cleanupStale(now: number): void {
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  const cutoff = now - WINDOW_MS * 2;
  for (const [key, ts] of userBuckets) {
    if (ts.length === 0 || ts[ts.length - 1] < cutoff) userBuckets.delete(key);
  }
  for (const [key, ts] of ipBuckets) {
    if (ts.length === 0 || ts[ts.length - 1] < cutoff) ipBuckets.delete(key);
  }
}

export type RateLimitDecision = {
  allowed: boolean;
  /** Which limiter blocked the request (null if allowed). */
  blockedBy: 'user_rate' | 'ip_rate' | 'user_burst' | null;
  /** Current count in the relevant window. */
  count: number;
  /** Max allowed in the relevant window. */
  limit: number;
  /** When the window resets (ms since epoch). */
  windowResetMs: number;
};

/**
 * Check AND record a request against rate limits.
 *
 * Returns a decision object. If `allowed` is false, the caller should
 * reject the request immediately with a 429 response.
 *
 * @param userId - Authenticated user ID.
 * @param clientIp - Client IP address (from x-forwarded-for or socket).
 */
export function checkRateLimit(userId: string, clientIp: string): RateLimitDecision {
  const now = Date.now();
  cleanupStale(now);

  // --- User burst check (short window, strict limit) ---
  const userTs = userBuckets.get(userId) || [];
  if (!userBuckets.has(userId)) userBuckets.set(userId, userTs);
  pruneWindow(userTs, WINDOW_MS, now); // prune against the larger window

  const burstCount = userTs.filter(t => t >= now - BURST_WINDOW_MS).length;
  if (burstCount >= BURST_LIMIT) {
    return {
      allowed: false,
      blockedBy: 'user_burst',
      count: burstCount,
      limit: BURST_LIMIT,
      windowResetMs: now + BURST_WINDOW_MS,
    };
  }

  // --- User rate check (sliding window) ---
  if (userTs.length >= USER_RATE_LIMIT) {
    return {
      allowed: false,
      blockedBy: 'user_rate',
      count: userTs.length,
      limit: USER_RATE_LIMIT,
      windowResetMs: userTs[0] + WINDOW_MS,
    };
  }

  // --- IP rate check (sliding window) ---
  const ipTs = ipBuckets.get(clientIp) || [];
  if (!ipBuckets.has(clientIp)) ipBuckets.set(clientIp, ipTs);
  pruneWindow(ipTs, WINDOW_MS, now);

  if (ipTs.length >= IP_RATE_LIMIT) {
    return {
      allowed: false,
      blockedBy: 'ip_rate',
      count: ipTs.length,
      limit: IP_RATE_LIMIT,
      windowResetMs: ipTs[0] + WINDOW_MS,
    };
  }

  // --- All checks passed — record the request ---
  userTs.push(now);
  ipTs.push(now);

  return {
    allowed: true,
    blockedBy: null,
    count: userTs.length,
    limit: USER_RATE_LIMIT,
    windowResetMs: now + WINDOW_MS,
  };
}

/**
 * Extract the client IP from a Next.js request, respecting reverse proxies.
 */
export function extractClientIp(req: { headers: { get(name: string): string | null }; ip?: string }): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp.trim();
  return (req as any).ip || '0.0.0.0';
}

/**
 * Return current config for observability / health checks.
 */
export function getRateLimitConfig() {
  return {
    userRateLimit: USER_RATE_LIMIT,
    ipRateLimit: IP_RATE_LIMIT,
    windowMs: WINDOW_MS,
    burstLimit: BURST_LIMIT,
    burstWindowMs: BURST_WINDOW_MS,
  };
}
