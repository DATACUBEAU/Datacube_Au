import { NextRequest, NextResponse } from 'next/server';
import { requireUserFromRequest } from '@/app/api/proxy/_supabase-auth';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const runtime = 'nodejs';
function reply(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store, private' } });
}
function field(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return clean && clean.length <= max && !/[\x00-\x1f\x7f]/.test(clean) ? clean : null;
}
export async function POST(req: NextRequest) {
  const auth = await requireUserFromRequest(req);
  if (!auth.ok || auth.source !== 'header') return reply({ ok: false }, 401);
  try {
    if (Number(req.headers.get('content-length') || 0) > 2048) return reply({ ok: false }, 413);
    const raw = await req.text();
    if (raw.length > 2048) return reply({ ok: false }, 413);
    const body = JSON.parse(raw);
    const supabase = createSupabaseAdminClient();
    const start = new Date(Math.floor(Date.now() / 3600000) * 3600000).toISOString();
    const limit = await supabase.rpc('au_rate_limit_hit', {
      p_key: 'device-report:' + auth.userId + ':' + start,
      p_owner_id: auth.userId, p_ip_hash: 'account', p_endpoint: '/api/account/device-report',
      p_window_start: start, p_window_seconds: 3600,
    });
    const count = Number(limit.data?.[0]?.current_count);
    if (limit.error || !Number.isSafeInteger(count) || count < 1) return reply({ ok: false }, 503);
    if (count > 10) return reply({ ok: false }, 429);
    if (body?.action === 'remove') {
      const result = await supabase.from('au_user_activity').update({ device_info: null }).eq('user_id', auth.userId);
      return reply({ ok: !result.error }, result.error ? 503 : 200);
    }
    if (body?.action !== 'share') return reply({ ok: false }, 400);
    const manufacturer = field(body.manufacturer, 60);
    const model = field(body.model, 80);
    const androidVersion = field(body.androidVersion, 30);
    const appVersion = field(body.appVersion, 40);
    const sdk = body.sdk;
    if (!manufacturer || !model || !androidVersion || !appVersion ||
      !Number.isInteger(sdk) || sdk < 26 || sdk > 100) return reply({ ok: false }, 400);
    // One self-reported snapshot per account. Never store IMEI, serial, Android ID,
    // phone number, location, IP, or installed model/document history here.
    const now = new Date().toISOString();
    const result = await supabase.from('au_user_activity').upsert([{
      user_id: auth.userId, last_active_at: now,
      device_info: { manufacturer, model, androidVersion, appVersion, sdk, reportedAt: now },
    }], { onConflict: 'user_id', defaultToNull: false });
    return reply({ ok: !result.error }, result.error ? 503 : 200);
  } catch { return reply({ ok: false }, 400); }
}
