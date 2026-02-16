import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'edge';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Use Service Role if available to manage admin logs, otherwise fallback (might fail if RLS is strict)
const supabaseAdmin = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY
);

export async function POST(req: Request) {
  try {
    const ip = req.headers.get('x-forwarded-for') || 'unknown';
    const body = await req.json();

    // 1. Check Brute Force Lockout
    // Get the latest log for this IP
    const { data: latestLog } = await supabaseAdmin
      .from('admin_access_logs')
      .select('*')
      .eq('ip_address', ip)
      .order('last_attempt_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestLog && latestLog.locked_until && new Date(latestLog.locked_until) > new Date()) {
      return NextResponse.json(
        { error: `Too many attempts. Access locked until ${new Date(latestLog.locked_until).toLocaleTimeString()}` },
        { status: 429 }
      );
    }

    // 2. Proxy Request to Edge Function (admin-handler)
    const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-handler`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify(body)
    });

    const data = await res.json();

    // 3. Handle Result & Update Logs
    if (!res.ok) {
      // Auth failed
      let newCount = 1;
      let lockedUntil = null;
      let logId = null;

      if (latestLog && (!latestLog.locked_until || new Date(latestLog.locked_until) < new Date())) {
        // Continue from previous session if recent (e.g. < 1 hour ago)
        const timeDiff = Date.now() - new Date(latestLog.last_attempt_at).getTime();
        if (timeDiff < 60 * 60 * 1000) {
           newCount = latestLog.attempt_count + 1;
           logId = latestLog.id;
        }
      }

      // Lockout Policy: 5 attempts -> 24h lock
      if (newCount >= 5) {
        lockedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      }

      if (logId) {
        await supabaseAdmin.from('admin_access_logs').update({
          attempt_count: newCount,
          locked_until: lockedUntil,
          last_attempt_at: new Date().toISOString()
        }).eq('id', logId);
      } else {
        await supabaseAdmin.from('admin_access_logs').insert({
          ip_address: ip,
          attempt_count: newCount,
          locked_until: lockedUntil,
          last_attempt_at: new Date().toISOString()
        });
      }

      return NextResponse.json(data, { status: res.status });
    }

    // Success - we don't clear logs, we keep them for audit.
    // But we might want to reset the "active" counter if we wanted to be nice.
    // For high security, we just leave it.
    
    return NextResponse.json(data);

  } catch (error: any) {
    console.error('[API /api/admin/auth] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
