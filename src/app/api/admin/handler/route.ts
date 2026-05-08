import { NextRequest, NextResponse } from 'next/server';
import { requireConexAdmin } from '@/app/api/feedback/_auth';

export const runtime = 'nodejs';

/**
 * Local admin handler — replaces the deleted Supabase Edge Function proxy.
 * All admin actions from /conex are routed here.
 * Uses service-role Supabase client from requireConexAdmin().
 */
export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const adminResult = await requireConexAdmin(req);
  if (!adminResult.ok) return adminResult.response;

  const supabase = adminResult.supabase;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'invalid_json', message: 'Invalid JSON body.', requestId },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const action = String(body?.action || '').trim();
  if (!action) {
    return NextResponse.json(
      { error: 'missing_action', message: 'Action is required.', requestId },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    switch (action) {
      case 'get_conex_config':
        return await handleGetConexConfig(supabase, requestId);
      case 'update_conex_config':
        return await handleUpdateConexConfig(supabase, body, requestId);
      case 'get_registry':
        return await handleGetRegistry(supabase, body, requestId);
      case 'update_api_key':
        return await handleUpdateApiKey(supabase, body, requestId);
      case 'delete_api_key':
        return await handleDeleteApiKey(supabase, body, requestId);
      case 'update_model':
        return await handleUpdateModel(supabase, body, requestId);
      case 'get_active_users':
        return await handleGetActiveUsers(supabase, requestId);
      case 'get_alert_config':
        return await handleGetAlertConfig(supabase, requestId);
      case 'update_alert_config':
        return await handleUpdateAlertConfig(supabase, body, requestId);
      case 'get_debug_logs':
        return await handleGetDebugLogs(supabase, requestId);
      case 'clear_logs':
        return await handleClearLogs(supabase, requestId);
      case 'verify_system':
        return await handleVerifySystem(supabase, requestId);
      case 'reload_schema':
        return await handleReloadSchema(supabase, requestId);
      default:
        return NextResponse.json(
          { error: 'unknown_action', message: `Unknown action: ${action}`, requestId },
          { status: 400, headers: { 'Cache-Control': 'no-store' } },
        );
    }
  } catch (error: any) {
    console.error(`[admin/handler] action=${action} failed:`, error?.message || error);
    return NextResponse.json(
      { error: 'handler_failed', message: String(error?.message || 'Admin action failed.'), requestId },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

// ─── Action Handlers ─────────────────────────────────────────────────────

async function handleGetConexConfig(supabase: any, requestId: string) {
  const { data, error } = await supabase
    .from('au_config')
    .select('*')
    .limit(1)
    .maybeSingle();

  if (error) {
    // Table doesn't exist — return empty config so admin panel can still load
    const code = String(error?.code || '');
    if (code === '42P01' || String(error?.message || '').includes('schema cache')) {
      return NextResponse.json(
        { config: {}, _warning: 'au_config table not found — run migration', requestId },
        { status: 200, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    throw error;
  }

  return NextResponse.json(
    { config: data || {}, requestId },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}

async function handleUpdateConexConfig(supabase: any, body: any, requestId: string) {
  const config = body?.config;
  if (!config || typeof config !== 'object') {
    return NextResponse.json(
      { error: 'invalid_config', message: 'Config object is required.', requestId },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // Upsert: update existing row or insert if none exists
  const { data: existing } = await supabase
    .from('au_config')
    .select('id')
    .limit(1)
    .maybeSingle();

  let result;
  if (existing?.id) {
    result = await supabase
      .from('au_config')
      .update(config)
      .eq('id', existing.id)
      .select()
      .maybeSingle();
  } else {
    result = await supabase
      .from('au_config')
      .insert(config)
      .select()
      .maybeSingle();
  }

  if (result.error) throw result.error;

  return NextResponse.json(
    { ok: true, config: result.data || config, requestId },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}

async function handleGetRegistry(supabase: any, body: any, requestId: string) {
  const [keysResult, modelsResult] = await Promise.all([
    supabase.from('au_api_keys').select('*').order('service'),
    supabase.from('au_model_routing').select('*').order('model_id'),
  ]);

  if (keysResult.error) {
    // Table may not exist yet — return empty
    const code = String(keysResult.error?.code || '');
    if (code !== '42P01') throw keysResult.error;
  }
  if (modelsResult.error) {
    const code = String(modelsResult.error?.code || '');
    if (code !== '42P01') throw modelsResult.error;
  }

  const keys = keysResult.data || [];
  const models = modelsResult.data || [];

  // Determine registry source from config
  const { data: config } = await supabase
    .from('au_config')
    .select('premium_models_paid_only')
    .limit(1)
    .maybeSingle();

  const registrySource = config?.premium_models_paid_only !== false ? 'pro' : 'free';

  return NextResponse.json(
    { keys, models, registrySource, diagnostics: { keyCount: keys.length, modelCount: models.length }, requestId },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}

async function handleUpdateApiKey(supabase: any, body: any, requestId: string) {
  const keyData = body?.keyData;
  if (!keyData || typeof keyData !== 'object') {
    return NextResponse.json(
      { error: 'invalid_key_data', message: 'keyData object is required.', requestId },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const service = String(keyData.service || '').trim();
  if (!service) {
    return NextResponse.json(
      { error: 'missing_service', message: 'Service name is required.', requestId },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const { data, error } = await supabase
    .from('au_api_keys')
    .upsert({ ...keyData, service, updated_at: new Date().toISOString() }, { onConflict: 'service' })
    .select()
    .maybeSingle();

  if (error) throw error;

  return NextResponse.json(
    { ok: true, key: data, requestId },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}

async function handleDeleteApiKey(supabase: any, body: any, requestId: string) {
  const service = String(body?.service || '').trim();
  if (!service) {
    return NextResponse.json(
      { error: 'missing_service', message: 'Service name is required.', requestId },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const { error } = await supabase
    .from('au_api_keys')
    .delete()
    .eq('service', service);

  if (error) throw error;

  return NextResponse.json(
    { ok: true, requestId },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}

async function handleUpdateModel(supabase: any, body: any, requestId: string) {
  const model = body?.model;
  const registry = body?.registry || 'free';
  if (!model || typeof model !== 'object' || !model.model_id) {
    return NextResponse.json(
      { error: 'invalid_model', message: 'Model object with model_id is required.', requestId },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const { data, error } = await supabase
    .from('au_model_routing')
    .upsert(
      { ...model, registry, updated_at: new Date().toISOString() },
      { onConflict: 'model_id' },
    )
    .select()
    .maybeSingle();

  if (error) throw error;

  return NextResponse.json(
    { ok: true, model: data, requestId },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}

async function handleGetActiveUsers(supabase: any, requestId: string) {
  const { data, error } = await supabase
    .from('au_user_profiles')
    .select('user_id,email,tier,last_active_at,display_name,created_at')
    .not('last_active_at', 'is', null)
    .order('last_active_at', { ascending: false })
    .limit(50);

  if (error) throw error;

  return NextResponse.json(
    { users: data || [], requestId },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}

async function handleGetAlertConfig(supabase: any, requestId: string) {
  const { data, error } = await supabase
    .from('au_config')
    .select('alert_config')
    .limit(1)
    .maybeSingle();

  if (error) {
    const code = String(error?.code || '');
    if (code === '42P01' || String(error?.message || '').includes('schema cache')) {
      return NextResponse.json(
        { config: {}, _warning: 'au_config table not found', requestId },
        { status: 200, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    throw error;
  }

  return NextResponse.json(
    { config: data?.alert_config || {}, requestId },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}

async function handleUpdateAlertConfig(supabase: any, body: any, requestId: string) {
  const config = body?.config;
  if (!config || typeof config !== 'object') {
    return NextResponse.json(
      { error: 'invalid_config', message: 'Alert config object is required.', requestId },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const { data: existing } = await supabase
    .from('au_config')
    .select('id')
    .limit(1)
    .maybeSingle();

  let result;
  if (existing?.id) {
    result = await supabase
      .from('au_config')
      .update({ alert_config: config })
      .eq('id', existing.id)
      .select()
      .maybeSingle();
  } else {
    result = await supabase
      .from('au_config')
      .insert({ alert_config: config })
      .select()
      .maybeSingle();
  }

  if (result.error) throw result.error;

  return NextResponse.json(
    { ok: true, requestId },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}

async function handleGetDebugLogs(supabase: any, requestId: string) {
  const { data, error } = await supabase
    .from('au_debug_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    const code = String(error?.code || '');
    if (code === '42P01') {
      // Table doesn't exist — return empty
      return NextResponse.json({ logs: [], requestId }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
    }
    throw error;
  }

  return NextResponse.json(
    { logs: data || [], requestId },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}

async function handleClearLogs(supabase: any, requestId: string) {
  const { error } = await supabase
    .from('au_debug_logs')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all

  if (error) {
    const code = String(error?.code || '');
    if (code !== '42P01') throw error;
  }

  return NextResponse.json(
    { ok: true, requestId },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}

async function handleVerifySystem(supabase: any, requestId: string) {
  const checks: Record<string, { ok: boolean; error?: string; latencyMs?: number }> = {};

  // Check au_config
  const t0 = Date.now();
  const { error: configErr } = await supabase.from('au_config').select('id').limit(1).maybeSingle();
  checks.au_config = { ok: !configErr, error: configErr?.message, latencyMs: Date.now() - t0 };

  // Check au_user_profiles
  const t1 = Date.now();
  const { error: profilesErr } = await supabase.from('au_user_profiles').select('user_id').limit(1);
  checks.au_user_profiles = { ok: !profilesErr, error: profilesErr?.message, latencyMs: Date.now() - t1 };

  // Check au_plan_limit_rules
  const t2 = Date.now();
  const { error: limitsErr } = await supabase.from('au_plan_limit_rules').select('id').limit(1);
  checks.au_plan_limit_rules = { ok: !limitsErr, error: limitsErr?.message, latencyMs: Date.now() - t2 };

  // Check billing_subscriptions
  const t3 = Date.now();
  const { error: subErr } = await supabase.from('billing_subscriptions').select('user_id').limit(1);
  checks.billing_subscriptions = { ok: !subErr, error: subErr?.message, latencyMs: Date.now() - t3 };

  const allOk = Object.values(checks).every((c) => c.ok);

  return NextResponse.json(
    { ok: allOk, checks, requestId },
    { status: allOk ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}

async function handleReloadSchema(supabase: any, requestId: string) {
  // Force Supabase PostgREST schema cache reload by calling a lightweight RPC or query
  const { error } = await supabase.rpc('reload_schema_cache').catch(() => ({ error: null }));

  return NextResponse.json(
    { ok: true, message: error ? 'Schema reload requested (RPC may not exist).' : 'Schema cache reloaded.', requestId },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}
