export type ReadinessDependencyState = 'ok' | 'unavailable' | 'timeout';

export type ReadinessProbeResult = {
  ok: boolean;
  dependency: ReadinessDependencyState;
  durationMs: number;
};

export const DEFAULT_READINESS_TIMEOUT_MS = 2000;

function normalizeTimeoutMs(value: number | undefined): number {
  if (!Number.isFinite(value) || Number(value) <= 0) {
    return DEFAULT_READINESS_TIMEOUT_MS;
  }
  return Math.max(100, Math.min(10000, Math.floor(Number(value))));
}

export async function runReadinessProbe(input: {
  check: (signal: AbortSignal) => Promise<void>;
  timeoutMs?: number;
}): Promise<ReadinessProbeResult> {
  const timeoutMs = normalizeTimeoutMs(input.timeoutMs);
  const startedAt = Date.now();
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new Error('readiness_timeout'));
    }, timeoutMs);
  });

  try {
    await Promise.race([
      input.check(controller.signal),
      timeoutPromise,
    ]);

    return {
      ok: true,
      dependency: 'ok',
      durationMs: Math.max(0, Date.now() - startedAt),
    };
  } catch {
    return {
      ok: false,
      dependency: timedOut ? 'timeout' : 'unavailable',
      durationMs: Math.max(0, Date.now() - startedAt),
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
