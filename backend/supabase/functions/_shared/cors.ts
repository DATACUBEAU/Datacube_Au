export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-upsert, tus-resumable, upload-length, upload-metadata, upload-offset",
};

export function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin");
  const allowedOriginsEnv = (Deno.env.get("ALLOWED_ORIGINS") ?? "").trim();
  const allowedOriginEnv = (Deno.env.get("ALLOWED_ORIGIN") ?? "*").trim();

  const allowedOrigins =
    allowedOriginsEnv.length > 0
      ? allowedOriginsEnv.split(",").map((s) => s.trim()).filter(Boolean)
      : allowedOriginEnv.split(",").map((s) => s.trim()).filter(Boolean);

  const allowsAny = allowedOrigins.includes("*");
  const isAllowed = !!origin && (allowsAny || allowedOrigins.includes(origin));
  const corsOrigin = isAllowed ? origin! : allowsAny ? (origin ?? "*") : (allowedOrigins[0] ?? "*");

  const headers: Record<string, string> = {
    ...corsHeaders,
    "Access-Control-Allow-Origin": corsOrigin,
    "Vary": "Origin",
  };

  if (corsOrigin !== "*") headers["Access-Control-Allow-Credentials"] = "true";

  if (origin && !isAllowed && !allowsAny) {
    const localhostOnly =
      allowedOrigins.length > 0 &&
      allowedOrigins.every((o) => o.startsWith("http://localhost") || o.startsWith("http://127.0.0.1"));
    if (localhostOnly && !origin.startsWith("http://localhost") && !origin.startsWith("http://127.0.0.1")) {
      console.warn(
        `[cors] Misconfiguration: only localhost origins are allowed, but request origin is ${origin}. ` +
          `Set ALLOWED_ORIGINS to include your production domain.`,
      );
    }
    console.warn(
      `[cors] Origin not allowed: ${origin}. Allowed: ${allowedOrigins.join(", ") || "(none)"}`,
    );
  }

  return headers;
}
