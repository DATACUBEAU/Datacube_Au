type SafeFetchConfig = {
  silent?: boolean;
  timeoutMs?: number;
  retries?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
};

function isRetryableStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

function backoffMs(attempt: number, baseMs: number, maxMs: number) {
  const exp = Math.min(maxMs, baseMs * Math.pow(2, attempt));
  const jitter = 0.2 * exp * (Math.random() - 0.5) * 2;
  return Math.max(0, Math.floor(exp + jitter));
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function safeFetch(url: string, options: RequestInit, config?: SafeFetchConfig) {
  const retries = config?.retries ?? 0;
  const timeoutMs = config?.timeoutMs ?? 0;
  const retryBaseMs = config?.retryBaseMs ?? 500;
  const retryMaxMs = config?.retryMaxMs ?? 10_000;

  for (let attempt = 0; attempt <= retries; attempt++) {
    let res: Response;

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    const callerSignal = options.signal;
    if (callerSignal) {
      if (callerSignal.aborted) controller.abort();
      else callerSignal.addEventListener('abort', onAbort, { once: true });
    }

    const timeoutId =
      timeoutMs > 0
        ? setTimeout(() => {
            controller.abort();
          }, timeoutMs)
        : null;

    try {
      let sanitizedUrl = url;
      if (sanitizedUrl.endsWith('.')) sanitizedUrl = sanitizedUrl.slice(0, -1);

      res = await fetch(sanitizedUrl, { ...options, signal: controller.signal });
    } catch (e: any) {
      if (timeoutId) clearTimeout(timeoutId);
      if (callerSignal) callerSignal.removeEventListener('abort', onAbort);

      if (e?.name === 'AbortError') throw e;

      if (attempt < retries) {
        await sleep(backoffMs(attempt, retryBaseMs, retryMaxMs));
        continue;
      }

      if (!config?.silent) console.error(`[safeFetch] Network error fetching ${url}:`, e);
      throw new Error(`Failed to fetch from ${url}. ${e.message || ''}`);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      if (callerSignal) callerSignal.removeEventListener('abort', onAbort);
    }

    let body: any = null;
    try {
      const text = await res.text();
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    } catch {
      body = null;
    }

    if (!res.ok) {
      if (attempt < retries && isRetryableStatus(res.status)) {
        await sleep(backoffMs(attempt, retryBaseMs, retryMaxMs));
        continue;
      }

      let errorMessage = `API Error ${res.status}`;
      if (body) {
        if (typeof body === 'string') {
          errorMessage = body;
        } else if (typeof body === 'object') {
          errorMessage = body.error || body.message || body.details || JSON.stringify(body);
        }
      }

      if (!config?.silent) {
        console.error(`[safeFetch] API error ${res.status} (${res.statusText}) on ${url}`);
        if (body) console.error(`[safeFetch] Response body:`, body);
        console.error(`[safeFetch] Error message:`, errorMessage);
      }

      const error = new Error(errorMessage);
      (error as any).status = res.status;
      (error as any).body = body;

      // Check for limit reached
      if (body && typeof body === 'object' && body.code === 'LIMIT_REACHED') {
          if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('au_limit_reached', { detail: body }));
          }
      }

      if (body && typeof body === 'object' && body.isThrottled) {
        (error as any).isThrottled = true;
      }
      throw error;
    }

    return body;
  }
}
