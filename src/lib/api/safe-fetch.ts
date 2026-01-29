export async function safeFetch(url: string, options: RequestInit, config?: { silent?: boolean }) {
  let res: Response;
  try {
    // If we have a trailing dot or malformed URL, try to sanitize it
    let sanitizedUrl = url;
    if (sanitizedUrl.endsWith('.')) {
        sanitizedUrl = sanitizedUrl.slice(0, -1);
    }

    res = await fetch(sanitizedUrl, options);
  } catch (e: any) {
    if (!config?.silent) {
      console.error(`[safeFetch] Network error fetching ${url}:`, e);
    }
    throw new Error(`Failed to fetch from ${url}. ${e.message || ''}`);
  }

  const contentType = res.headers.get("content-type") || "";
  let body;
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
    // Extract meaningful error message
    let errorMessage = `API Error ${res.status}`;
    if (body) {
      if (typeof body === 'string') {
        errorMessage = body;
      } else if (typeof body === 'object') {
        // Prioritize 'error' field as it usually contains our clean message
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
    throw error;
  }

  return body;
}
