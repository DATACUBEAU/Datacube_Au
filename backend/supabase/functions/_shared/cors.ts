export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-upsert, tus-resumable, upload-length, upload-metadata, upload-offset",
};

export function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin");
  const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN") || "*";
  
  // If allowedOrigin is *, we echo back the request's origin
  // If allowedOrigin matches the request's origin, we return it
  // Otherwise we return the allowedOrigin (which will cause a CORS error in the browser if it doesn't match)
  const corsOrigin = (allowedOrigin === "*" || allowedOrigin === origin) 
    ? (origin || "*") 
    : allowedOrigin;

  return {
    ...corsHeaders,
    "Access-Control-Allow-Origin": corsOrigin,
    "Access-Control-Allow-Credentials": "true",
  };
}
