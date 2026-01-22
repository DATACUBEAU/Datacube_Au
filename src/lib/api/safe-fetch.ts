export async function safeFetch(url: string, options: RequestInit) {
  let res: Response;
  try {
    res = await fetch(url, options);
  } catch (e: any) {
    console.error(`[safeFetch] Network error fetching ${url}:`, e);
    throw new Error(`Failed to fetch from ${url}. ${e.message || ''}`);
  }

  const contentType = res.headers.get("content-type") || "";
  const body = contentType.includes("application/json")
    ? await res.json().catch(() => null)
    : await res.text().catch(() => null);

  if (!res.ok) {
    console.error("API error", {
      status: res.status,
      body,
    });

    throw {
      status: res.status,
      body,
    };
  }

  return body;
}
