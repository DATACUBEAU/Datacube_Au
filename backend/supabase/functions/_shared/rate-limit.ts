import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getIpHash } from "./security.ts";

function windowStart(now: Date, windowSeconds: number): Date {
  const ms = now.getTime();
  const w = windowSeconds * 1000;
  return new Date(Math.floor(ms / w) * w);
}

function makeKey(endpoint: string, ownerId: string | null, ipHash: string | null, wstartIso: string) {
  return `${endpoint}:${ownerId ?? "-"}:${ipHash ?? "-"}:${wstartIso}`;
}

export type RateLimitConfig = {
  endpoint: string;
  ownerId?: string | null;
  windowSeconds: number;
  limit: number;
};

export async function rateLimitOrThrow(req: Request, cfg: RateLimitConfig) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(supabaseUrl, serviceKey);

  const now = new Date();
  const ws = windowStart(now, cfg.windowSeconds);
  const wsIso = ws.toISOString();

  const ipHash = await getIpHash(req);
  const key = makeKey(cfg.endpoint, cfg.ownerId ?? null, ipHash, wsIso);

  // Call the dedicated RPC
  const { data, error } = await sb.rpc("au_rate_limit_hit", {
    p_key: key,
    p_owner_id: cfg.ownerId ?? null,
    p_ip_hash: ipHash,
    p_endpoint: cfg.endpoint,
    p_window_start: wsIso,
    p_window_seconds: cfg.windowSeconds
  });

  if (error) {
      console.error("Rate limit RPC error:", error);
      // Fail open (allow request) if DB error to avoid outage
      return; 
  }

  // RPC returns array of objects { current_count, expires_at }
  const result = Array.isArray(data) ? data[0] : data;
  const count = result?.current_count ?? 1;

  if (count > cfg.limit) {
    throw {
        status: 429,
        errorType: "rate_limit",
        message: "Too many requests. Try again shortly."
    };
  }
}
