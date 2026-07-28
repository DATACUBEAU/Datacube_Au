import { NextRequest, NextResponse } from 'next/server';
import {
  accessControlResponse,
  isAccessControlError,
  requireAdmin,
} from '@/lib/server/authorization';

export const runtime = 'nodejs';

function firstEnv(...keys: string[]): string | null {
  for (const key of keys) {
    const value = process.env[key];
    if (value && value.trim().length > 0) return value;
  }
  return null;
}

function sanitizeCredentialPayload(value: unknown, keyHint = '', depth = 0): unknown {
  const lowered = String(keyHint || '').toLowerCase();
  if (
    lowered.includes('authorization') ||
    lowered.includes('cookie') ||
    lowered.includes('token') ||
    lowered.includes('secret') ||
    lowered.includes('password') ||
    lowered.includes('credential') ||
    lowered.includes('api_key') ||
    lowered.includes('accesskey') ||
    lowered.includes('access_key') ||
    lowered.includes('key_value') ||
    lowered.includes('provider_key')
  ) {
    return '[REDACTED]';
  }

  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return value.length > 300 ? `${value.slice(0, 300)}...` : value;
  }
  if (depth >= 4) return '[REDACTED_DEPTH]';
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((entry) => sanitizeCredentialPayload(entry, keyHint, depth + 1));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        sanitizeCredentialPayload(entry, key, depth + 1),
      ]),
    );
  }

  return '[REDACTED]';
}

function safeUpstreamResponse(payload: unknown, fallbackError?: string): Record<string, unknown> {
  const sanitized = sanitizeCredentialPayload(payload);
  if (sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)) {
    const next = sanitized as Record<string, unknown>;
    if (fallbackError && !next.error && !next.message) next.error = fallbackError;
    return next;
  }
  return fallbackError ? { error: fallbackError } : {};
}

export async function POST(req: NextRequest) {
  try {
    const SUPABASE_URL = firstEnv('NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL');
    const SUPABASE_ANON_KEY = firstEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY');

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return NextResponse.json(
        { error: 'server_misconfigured', message: 'Missing Supabase URL or anon key.' },
        { status: 503 }
      );
    }

    const authorization = await requireAdmin(req);
    const auth = authorization.auth;
    const supabaseAdmin = authorization.supabase;

    const ip = req.headers.get('x-forwarded-for') || 'unknown';
    const body = await req.json();

    // 1. Check Brute Force Lockout
    // Get the latest log for this IP
    const { data: latestLog } = await supabaseAdmin
      .from('admin_access_logs')
      .select('id,attempt_count,locked_until,last_attempt_at')
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
        console.error('[API /api/admin/auth] Failed to parse JSON body.');
        data = { error: 'Invalid JSON response from upstream' };
      }
    } else {
      await res.text().catch(() => '');
      console.error('[API /api/admin/auth] Non-JSON response from Edge Function.');
      data = { error: `Edge Function returned status ${res.status}` };
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

      return NextResponse.json(
        safeUpstreamResponse(data, 'admin_auth_failed'),
        { status: res.status, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    // Success - we don't clear logs, we keep them for audit.
    // But we might want to reset the "active" counter if we wanted to be nice.
    // For high security, we just leave it.
    
    return NextResponse.json(
      safeUpstreamResponse(data),
      { headers: { 'Cache-Control': 'no-store' } },
    );

  } catch (error: any) {
    if (isAccessControlError(error)) {
      return accessControlResponse(error);
    }
    console.error('[API /api/admin/auth] Error.');
    return NextResponse.json(
      { error: 'admin_auth_failed', message: 'Admin authentication failed.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
