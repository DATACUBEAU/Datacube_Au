import { NextRequest, NextResponse } from 'next/server';
import { requireUserFromRequest } from '@/app/api/proxy/_supabase-auth';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const runtime = 'nodejs';

const ALLOWED_EVENTS = new Set(['activity', 'sign_in', 'sign_out', 'session_end']);

function jsonNoStore(body: unknown, init: ResponseInit = {}): NextResponse {
  const headers = new Headers(init.headers);
  headers.set('Cache-Control', 'no-store, private');
  return NextResponse.json(body, { ...init, headers });
}

function safeString(value: unknown, maxLength = 80): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function safeBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function sanitizeActivityMetadata(raw: unknown): Record<string, unknown> {
  const input = raw && typeof raw === 'object' ? (raw as Record<string, any>) : {};
  const connection = input.connection && typeof input.connection === 'object' ? input.connection : {};
  const pwa = input.pwa && typeof input.pwa === 'object' ? input.pwa : {};
  const device = input.device && typeof input.device === 'object' ? input.device : {};

  return {
    connection: {
      isOnline: safeBoolean(connection.isOnline),
      checked_at: safeString(connection.checked_at, 40),
    },
    pwa: {
      isStandalone: safeBoolean(pwa.isStandalone),
      isInstalled: safeBoolean(pwa.isInstalled),
      displayMode: safeString(pwa.displayMode, 40),
    },
    device: {
      browserName: safeString(device.browserName, 80),
      platform: safeString(device.platform, 80),
      osName: safeString(device.osName, 80),
      deviceType: safeString(device.deviceType, 40),
      isMobile: safeBoolean(device.isMobile),
      language: safeString(device.language, 40),
    },
    recorded_at: new Date().toISOString(),
  };
}

function resolveEvent(value: unknown): string {
  const event = String(value || 'activity').trim();
  return ALLOWED_EVENTS.has(event) ? event : 'activity';
}

function isMissingActivityTableError(error: unknown): boolean {
  const code = String((error as any)?.code || '').trim().toUpperCase();
  const message = String((error as any)?.message || '').toLowerCase();
  const details = String((error as any)?.details || '').toLowerCase();
  return (
    code === '42P01' ||
    code === '42703' ||
    code === 'PGRST205' ||
    (message.includes('relation') && message.includes('does not exist')) ||
    (message.includes('column') && message.includes('does not exist')) ||
    details.includes('could not find the table')
  );
}

export async function POST(req: NextRequest) {
  const auth = await requireUserFromRequest(req);
  if (!auth.ok) {
    return jsonNoStore({ error: 'unauthorized' }, { status: auth.status });
  }

  const body = await req.json().catch(() => ({}));
  const event = resolveEvent((body as any)?.event);
  const metadata = sanitizeActivityMetadata((body as any)?.metadata);
  const nowIso = new Date().toISOString();
  const supabase = createSupabaseAdminClient();

  try {
    const { error: rpcError } = await supabase.rpc('record_user_activity', {
      p_user_id: auth.userId,
      p_event: event,
      p_metadata: metadata,
    });
    if (rpcError) {
      throw rpcError;
    }

    const { error: upsertError } = await supabase
      .from('au_user_activity')
      .upsert(
        {
          user_id: auth.userId,
          last_active_at: nowIso,
          user_agent: safeString(req.headers.get('user-agent'), 256),
          is_pwa: Boolean((metadata.pwa as any)?.isStandalone || (metadata.pwa as any)?.isInstalled),
          metadata,
        },
        { onConflict: 'user_id' },
      );

    if (upsertError && !isMissingActivityTableError(upsertError)) {
      throw upsertError;
    }

    return jsonNoStore({ ok: true, recorded: true }, { status: 200 });
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[auth-activity] server activity update failed.', {
        event,
        code: (error as any)?.code || 'unknown',
      });
    }
    return jsonNoStore({ error: 'activity_update_failed' }, { status: 500 });
  }
}

export async function GET() {
  return jsonNoStore({ error: 'method_not_allowed' }, { status: 405 });
}
