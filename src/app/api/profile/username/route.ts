import { NextRequest, NextResponse } from 'next/server';
import { requireUserFromRequest } from '@/app/api/proxy/_supabase-auth';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';
import {
  USERNAME_TAKEN_MESSAGE,
  isUsernameTakenError,
  validateUsername,
} from '@/lib/auth/username';

export const runtime = 'nodejs';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store',
  Vary: 'Authorization, Cookie',
};

function isSchemaNotReady(error: any): boolean {
  const code = String(error?.code || '').trim();
  const message = String(error?.message || '').toLowerCase();
  return (
    code === '42703' ||
    code === '42P01' ||
    message.includes('schema cache') ||
    message.includes('column') && message.includes('does not exist') ||
    message.includes('relation') && message.includes('does not exist')
  );
}

function json(body: Record<string, unknown>, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...NO_STORE_HEADERS,
      ...(init?.headers ?? {}),
    },
  });
}

async function isUsernameAvailable(normalizedUsername: string, excludingUserId?: string | null) {
  const supabase = createSupabaseAdminClient();
  let query = supabase
    .from('au_user_profiles')
    .select('user_id', { count: 'exact', head: true })
    .eq('username_normalized', normalizedUsername);

  if (excludingUserId) {
    query = query.neq('user_id', excludingUserId);
  }

  const { count, error } = await query;
  if (error) throw error;
  return Number(count || 0) === 0;
}

export async function GET(req: NextRequest) {
  const usernameParam = req.nextUrl.searchParams.get('username');

  if (usernameParam !== null) {
    const validation = validateUsername(usernameParam);
    if (!validation.ok) {
      return json(
        {
          ok: false,
          available: false,
          code: 'invalid_username',
          message: validation.message,
        },
        { status: 400 },
      );
    }

    try {
      const available = await isUsernameAvailable(validation.normalized);
      return json({
        ok: true,
        username: validation.normalized,
        available,
        message: available ? 'Username is available.' : USERNAME_TAKEN_MESSAGE,
      });
    } catch (error: any) {
      if (isSchemaNotReady(error)) {
        return json(
          {
            ok: false,
            available: false,
            code: 'username_schema_not_ready',
            message: 'Username setup is not ready yet.',
          },
          { status: 503 },
        );
      }
      return json(
        {
          ok: false,
          available: false,
          code: 'username_check_failed',
          message: 'Could not check username availability.',
        },
        { status: 500 },
      );
    }
  }

  const auth = await requireUserFromRequest(req);
  if (!auth.ok) {
    return json(
      {
        ok: false,
        code: 'unauthorized',
        message: 'Sign in required.',
      },
      { status: 401 },
    );
  }

  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from('au_user_profiles')
      .select('username, username_normalized')
      .eq('user_id', auth.userId)
      .maybeSingle();

    if (error) throw error;

    const username =
      typeof (data as any)?.username_normalized === 'string' && (data as any).username_normalized
        ? String((data as any).username_normalized)
        : null;
    return json({
      ok: true,
      username,
      needsUsername: !username,
    });
  } catch (error: any) {
    if (isSchemaNotReady(error)) {
      return json(
        {
          ok: false,
          code: 'username_schema_not_ready',
          message: 'Username setup is not ready yet.',
        },
        { status: 503 },
      );
    }
    return json(
      {
        ok: false,
        code: 'username_fetch_failed',
        message: 'Could not load username.',
      },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireUserFromRequest(req);
  if (!auth.ok) {
    return json(
      {
        ok: false,
        code: 'unauthorized',
        message: 'Sign in required.',
      },
      { status: 401 },
    );
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const validation = validateUsername(body?.username);
  if (!validation.ok) {
    return json(
      {
        ok: false,
        code: 'invalid_username',
        message: validation.message,
      },
      { status: 400 },
    );
  }

  try {
    const available = await isUsernameAvailable(validation.normalized, auth.userId);
    if (!available) {
      return json(
        {
          ok: false,
          code: 'username_taken',
          message: USERNAME_TAKEN_MESSAGE,
        },
        { status: 409 },
      );
    }

    const supabase = createSupabaseAdminClient();
    const { error } = await supabase
      .from('au_user_profiles')
      .upsert(
        {
          user_id: auth.userId,
          username: validation.normalized,
          username_normalized: validation.normalized,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      );

    if (error) throw error;

    return json({
      ok: true,
      username: validation.normalized,
      needsUsername: false,
    });
  } catch (error: any) {
    if (isUsernameTakenError(error)) {
      return json(
        {
          ok: false,
          code: 'username_taken',
          message: USERNAME_TAKEN_MESSAGE,
        },
        { status: 409 },
      );
    }
    if (isSchemaNotReady(error)) {
      return json(
        {
          ok: false,
          code: 'username_schema_not_ready',
          message: 'Username setup is not ready yet.',
        },
        { status: 503 },
      );
    }
    return json(
      {
        ok: false,
        code: 'username_save_failed',
        message: 'Could not save username.',
      },
      { status: 500 },
    );
  }
}
