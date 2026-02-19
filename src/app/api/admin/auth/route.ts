import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireUserFromRequest } from '@/app/api/proxy/_supabase-auth';
import { hasConexAccess } from '@/lib/conex-rbac';

export const runtime = 'edge';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Use Service Role if available to manage admin logs, otherwise fallback (might fail if RLS is strict)
const supabaseAdmin = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY
);

export async function POST(req: NextRequest) {
  try {
    const auth = await requireUserFromRequest(req);
    if (!auth.ok) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('au_user_profiles')
      .select('user_id,tier')
      .eq('user_id', auth.userId)
      .maybeSingle();

    if (profileError) {
      console.error('[API /api/admin/auth] Failed to read au_user_profiles:', profileError);
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const allowed = hasConexAccess({
      userId: auth.userId,
      email: auth.email ?? null,
      tier: profile?.tier ?? null,
    });

    if (!allowed) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

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
    const functionUrl = `${SUPABASE_URL}/functions/v1/admin-handler`;
    console.log('[API /api/admin/auth] Proxying to:', functionUrl);

    const res = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${auth.accessToken}`,
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(body)
    });

    let data;
    const contentType = res.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      try {
        data = await res.json();
      } catch (e) {
        console.error('[API /api/admin/auth] Failed to parse JSON body:', e);
        data = { error: 'Invalid JSON response from upstream' };
      }
    } else {
      const text = await res.text();
      console.error('[API /api/admin/auth] Non-JSON response from Edge Function:', text);
      try {
          data = JSON.parse(text);
      } catch (e) {
          // Use the text as error message if not JSON
          data = { error: text || `Edge Function returned status ${res.status}` };
      }
    }

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
