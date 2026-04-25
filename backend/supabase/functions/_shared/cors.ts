export const corsHeaders = {
  "Access-Control-Allow-Origin": "*", // This will be overridden by getCorsHeaders
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-upsert, x-admin-token, tus-resumable, upload-length, upload-metadata, upload-offset, x-device-id, x-supabase-client-platform",
};

export function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin");
  const allowedOriginsEnv = (Deno.env.get("ALLOWED_ORIGINS") ?? "").trim();
  
  // If NO allowed origins are set in env, default to * (Permissive Mode)
  // This is critical for development or when env vars are missing.
  if (allowedOriginsEnv.length === 0) {
      return {
          ...corsHeaders,
          "Access-Control-Allow-Origin": "*",
          "Vary": "Origin",
      };
  }

  // Strict mode: Only allow what's in the list
  const allowedOrigins = allowedOriginsEnv.split(",").map((s) => s.trim()).filter(Boolean);

  // In production, we should NEVER allow any unless explicitly set to * in ALLOWED_ORIGINS
  const allowsAny = allowedOrigins.includes("*");
  const isAllowed = !!origin && (allowsAny || allowedOrigins.includes(origin));

  // Determine the response origin. 
  // If allowed, return the request origin. 
  // If not allowed and * is not in the list, return the first allowed origin as a fallback (or null/empty)
  const corsOrigin = isAllowed ? origin! : allowsAny ? "*" : (allowedOrigins[0] ?? "");

  const headers: Record<string, string> = {
    ...corsHeaders,
    "Access-Control-Allow-Origin": corsOrigin,
    "Vary": "Origin",
  };

  if (corsOrigin !== "*" && corsOrigin !== "") {
    headers["Access-Control-Allow-Credentials"] = "true";
  }

  if (origin && !isAllowed && !allowsAny) {
    console.warn(`[cors] Origin not allowed: ${origin}. Allowed: ${allowedOrigins.join(", ") || "(none)"}`);
  }

  return headers;
}
