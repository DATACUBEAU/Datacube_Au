import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getIpHash } from "./security.ts";
import { getDeviceIdFromReq } from "./device.ts";

export async function checkAdminLockOrThrow(req: Request, route = "/conex") {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const ipHash = await getIpHash(req);
  const deviceId = getDeviceIdFromReq(req);
  const lockKey = `${ipHash ?? "noip"}:${deviceId}:${route}`;

  const { data, error } = await sb
    .from("au_admin_locks")
    .select("locked_until")
    .eq("lock_key", lockKey)
    .maybeSingle();

  if (error) {
      console.error("Admin lock check error:", error);
      // Fail safe: assume not locked if DB error
  }
  
  if (data?.locked_until && new Date(data.locked_until) > new Date()) {
    throw {
        status: 423,
        errorType: "admin_locked",
        message: "Too many failed attempts. Try again later.",
        locked_until: data.locked_until
    };
  }

  return { lockKey, ipHash, deviceId };
}

export async function recordAdminAttempt(lockKey: string, ipHash: string, deviceId: string, route: string, success: boolean, attemptType = 'passcode') {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const now = new Date();

  // Log attempt
  await sb.from("au_admin_auth_attempts").insert({
      ip_hash: ipHash,
      device_id: deviceId,
      route,
      attempt_type: attemptType,
      success
  });

  if (success) {
    await sb.from("au_admin_locks").delete().eq("lock_key", lockKey);
    return;
  }

  const { data, error } = await sb
    .from("au_admin_locks")
    .upsert({ lock_key: lockKey, locked_until: now.toISOString(), fail_count: 1 }, { onConflict: "lock_key" })
    .select("fail_count")
    .single();

  if (error) {
      console.error("Failed to record admin attempt:", error);
      return;
  }
  
  const failCount = data.fail_count as number;

  let lockedUntil = now;
  if (failCount >= 10) lockedUntil = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  else if (failCount >= 5) lockedUntil = new Date(now.getTime() + 10 * 60 * 1000);

  // Only update lock time if we hit a threshold
  if (failCount >= 5) {
      await sb.from("au_admin_locks")
        .update({ locked_until: lockedUntil.toISOString() })
        .eq("lock_key", lockKey);
  }
}
