import { NextRequest, NextResponse } from 'next/server';
import { requireUserFromRequest } from '@/app/api/proxy/_supabase-auth';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const runtime = 'nodejs';

const ALLOWED_EVENTS = new Set(['activity', 'sign_in', 'sign_out', 'session_end']);

type ActivityErrorCategory =
  | 'ACTIVITY_RPC_MISSING'
  | 'ACTIVITY_RPC_SIGNATURE_MISMATCH'
  | 'ACTIVITY_COLUMN_MISMATCH'
  | 'ACTIVITY_RLS_DENIED'
  | 'ACTIVITY_GRANT_MISSING'
  | 'ACTIVITY_SERVER_CLIENT_CONFIG_ERROR'
  | 'ACTIVITY_DATABASE_WRITE_FAILED';

function jsonNoStore(body: unknown, init: ResponseInit = {}): NextResponse {
  const headers = new Headers(init.headers);
  headers.set('Cache-Control', 'no-store, private');
  return NextResponse.json(body, { ...init, headers });
}

function createSafeRequestId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `activity_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }
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

function classifyActivityError(error: unknown): ActivityErrorCategory {
  const code = String((error as any)?.code || '').trim().toUpperCase();
  const message = String((error as any)?.message || '').toLowerCase();
  const details = String((error as any)?.details || '').toLowerCase();
  const hint = String((error as any)?.hint || '').toLowerCase();

  if (code === 'PGRST202' || message.includes('could not find the function')) {
    return 'ACTIVITY_RPC_MISSING';
  }
  if (code === '42883' || message.includes('function') || details.includes('function')) {
    return 'ACTIVITY_RPC_SIGNATURE_MISMATCH';
  }
  if (code === '42703' || message.includes('column') || details.includes('column')) {
    return 'ACTIVITY_COLUMN_MISMATCH';
  }
  if (code === '42501' || message.includes('permission denied') || hint.includes('permission')) {
    return 'ACTIVITY_GRANT_MISSING';
  }
  if (code === 'PGRST301' || message.includes('row-level security') || details.includes('row-level security')) {
    return 'ACTIVITY_RLS_DENIED';
  }
  if (message.includes('missing supabase') || message.includes('environment variable')) {
    return 'ACTIVITY_SERVER_CLIENT_CONFIG_ERROR';
  }
  return 'ACTIVITY_DATABASE_WRITE_FAILED';
}

export async function POST(req: NextRequest) {
  const requestId = createSafeRequestId();
  const auth = await requireUserFromRequest(req);
  if (!auth.ok) {
    return jsonNoStore(
      {
        ok: false,
        error: 'unauthorized',
        code: auth.reason === 'missing_token' ? 'ACTIVITY_AUTH_MISSING' : 'ACTIVITY_USER_VALIDATION_FAILED',
        requestId,
      },
      { status: auth.status },
    );
  }

  const body = await req.json().catch(() => ({}));
  const event = resolveEvent((body as any)?.event);
  const metadata = sanitizeActivityMetadata((body as any)?.metadata);
  const nowIso = new Date().toISOString();

  try {
    const supabase = createSupabaseAdminClient();

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

    if (upsertError) {
      throw upsertError;
    }

    const profilePatch: Record<string, string> = {
      last_activity_at: nowIso,
    };
    if (event === 'sign_in') {
      profilePatch.last_sign_in_at = nowIso;
    } else if (event === 'sign_out') {
      profilePatch.last_sign_out_at = nowIso;
      profilePatch.last_session_end_at = nowIso;
    } else if (event === 'session_end') {
      profilePatch.last_session_end_at = nowIso;
    }

    const { error: profileError } = await supabase
      .from('au_user_profiles')
      .update(profilePatch)
      .eq('user_id', auth.userId);

    if (profileError && process.env.NODE_ENV !== 'production') {
      console.warn('[auth-activity] profile activity sync degraded.', {
        requestId,
        code: classifyActivityError(profileError),
      });
    }

    return jsonNoStore(
      { ok: true, recorded: true, requestId, profileSynced: !profileError },
      { status: 200 },
    );
  } catch (error) {
    const code = classifyActivityError(error);
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[auth-activity] server activity update failed.', {
        requestId,
        code,
      });
    }
    return jsonNoStore(
      {
        ok: true,
        recorded: false,
        degraded: true,
        error: 'activity_update_degraded',
        code,
        requestId,
      },
      { status: 202 },
    );
  }
}

export async function GET() {
  return jsonNoStore({ ok: false, error: 'method_not_allowed', requestId: createSafeRequestId() }, { status: 405 });
}
