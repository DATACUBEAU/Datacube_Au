export async function safeFetch(url: string, options: RequestInit) {
  let res: Response;
  try {
    // If we have a trailing dot or malformed URL, try to sanitize it
    let sanitizedUrl = url;
    if (sanitizedUrl.endsWith('.')) {
        sanitizedUrl = sanitizedUrl.slice(0, -1);
    }

    res = await fetch(sanitizedUrl, options);
  } catch (e: any) {
    console.error(`[safeFetch] Network error fetching ${url}:`, e);
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
    console.error("API error", {
      status: res.status,
      statusText: res.statusText,
      body,
    });

    // Extract meaningful error message
    let errorMessage = `API Error ${res.status}`;
    if (body) {
      if (typeof body === 'string') {
        errorMessage = body;
      } else if (typeof body === 'object') {
        errorMessage = body.error || body.message || body.details || JSON.stringify(body);
      }
    }

    const error = new Error(errorMessage);
    (error as any).status = res.status;
    (error as any).body = body;
    throw error;
  }

  return body;
}
