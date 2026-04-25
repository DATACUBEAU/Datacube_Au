export async function hmacSha256Hex(message: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export function getClientIp(req: Request): string | null {
  // 1. Trust cf-connecting-ip (Cloudflare) - hardest to spoof if behind CF
  const cfIp = req.headers.get("cf-connecting-ip");
  if (cfIp && cfIp.trim() !== "") return cfIp.trim();

  // 2. Trust x-real-ip (Supabase/Edge)
  const realIp = req.headers.get("x-real-ip");
  if (realIp && realIp.trim() !== "") return realIp.trim();

  // 3. Fallback to x-forwarded-for (First IP only)
  // Warning: Can be spoofed if not strictly behind a proxy that overwrites/appends correctly
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0].trim();
    if (first !== "") return first;
  }
  
  return null;
}

export async function getIpHash(req: Request): Promise<string | null> {
  const ip = getClientIp(req);
  if (!ip) return null;
  const pepper = Deno.env.get("IP_HASH_PEPPER");
  if (!pepper) {
      console.warn("Missing IP_HASH_PEPPER secret, using fallback");
      return ip; // Fallback if secret missing (dev mode)
  }
  return await hmacSha256Hex(ip, pepper);
}
