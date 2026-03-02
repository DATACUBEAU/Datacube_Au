import { NextRequest, NextResponse } from 'next/server';
import { requireUserFromRequest } from '@/app/api/proxy/_supabase-auth';
import { hasConexAccess } from '@/lib/conex-rbac';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const runtime = 'nodejs';

type FlagScope = 'global' | 'org' | 'user';

function normalizeScope(value: unknown): FlagScope {
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw === 'org') return 'org';
  if (raw === 'user') return 'user';
  return 'global';
}

function normalizeConfig(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function isSchemaDriftError(error: any): boolean {
  const code = String(error?.code || '').trim();
  const message = String(error?.message || '').toLowerCase();
  return (
    code === '42P01' ||
    code === '42703' ||
    (message.includes('relation') && message.includes('does not exist')) ||
    (message.includes('column') && message.includes('does not exist'))
  );
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireUserFromRequest(req);
    if (!auth.ok) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const supabase = createSupabaseAdminClient();
    const { data: profile, error: profileError } = await supabase
      .from('au_user_profiles')
      .select('tier')
      .eq('user_id', auth.userId)
      .maybeSingle();

    if (profileError) {
      console.error('[api/admin/feature-flags] profile lookup failed', {
        userId: auth.userId,
        code: profileError.code,
        message: profileError.message,
      });
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const allowed = hasConexAccess({
      userId: auth.userId,
      email: auth.email,
      tier: (profile as any)?.tier ?? null,
    });
    if (!allowed) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const key = String((body as any)?.key || '').trim();
    if (!key) {
      return NextResponse.json({ error: 'flag_key_required' }, { status: 400 });
    }

    const enabled = Boolean((body as any)?.enabled);
    const category = String((body as any)?.category || 'general').trim() || 'general';
    const description = String((body as any)?.description || '');
    const scope = normalizeScope((body as any)?.scope);
    const config = normalizeConfig((body as any)?.config);
    const nowIso = new Date().toISOString();

    const upsertFeatureFlags = async (nextKey: string, nextEnabled: boolean) => {
      const write = await supabase
        .from('feature_flags')
        .upsert(
          {
            key: nextKey,
            enabled: nextEnabled,
            category,
            description,
            scope,
            config,
            updated_at: nowIso,
          },
          { onConflict: 'key' }
        )
        .select('id,key,enabled,category,description,scope,org_id,user_id,config,updated_at')
        .maybeSingle();

      if (!write.error) return write.data;
      if (!isSchemaDriftError(write.error)) throw write.error;

      const legacyWrite = await supabase
        .from('au_feature_flags')
        .upsert(
          {
            key: nextKey,
            is_enabled: nextEnabled,
            description,
            updated_at: nowIso,
          },
          { onConflict: 'key' }
        )
        .select('key,is_enabled,description,updated_at')
        .maybeSingle();

      if (legacyWrite.error) throw legacyWrite.error;

      const legacy = legacyWrite.data as any;
      return {
        id: `legacy-${nextKey}`,
        key: String(legacy?.key || nextKey),
        enabled: Boolean(legacy?.is_enabled),
        category,
        description: String(legacy?.description || ''),
        scope: 'global',
        org_id: null,
        user_id: null,
        config: {},
        updated_at: String(legacy?.updated_at || nowIso),
      };
    };

    const row = await upsertFeatureFlags(key, enabled);

    if (key === 'billing_enabled' && enabled) {
      await upsertFeatureFlags('promo_enabled', false);
    } else if (key === 'promo_enabled' && enabled) {
      await upsertFeatureFlags('billing_enabled', false);
    }

    return NextResponse.json(
      { ok: true, flag: row },
      {
        status: 200,
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  } catch (error: any) {
    console.error('[api/admin/feature-flags] unexpected error', {
      message: String(error?.message || error),
    });
    return NextResponse.json(
      { error: 'internal_server_error', message: String(error?.message || 'Unknown error') },
      { status: 500 }
    );
  }
}
