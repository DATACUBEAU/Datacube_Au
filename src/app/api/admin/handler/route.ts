import { NextRequest, NextResponse } from 'next/server';
import { requireConexAdmin } from '@/app/api/feedback/_auth';
import {
  encryptProviderKey,
  providerKeyFingerprint,
  providerKeyLast4,
} from '@/lib/server/provider-key-encryption';

export const runtime = 'nodejs';

const PROVIDER_KEY_PUBLIC_COLUMNS =
  'service,provider_type,key_last4,key_fingerprint,is_active,allowed_models,metadata,error_count,last_used_at,rotated_at,revoked_at,created_at,updated_at';
const AU_CONFIG_COLUMNS = [
  'id',
  'billing_enabled',
  'free_chat_daily_limit',
  'free_exam_daily_limit',
  'free_upload_daily_limit',
  'free_max_upload_mb',
  'premium_models_paid_only',
  'stripe_price_weekly',
  'stripe_price_monthly',
  'stripe_price_weekly_id',
  'stripe_price_monthly_id',
  'bank_name',
  'bank_account_number',
  'bank_account_name',
  'bank_instructions',
  'alert_config',
  'created_at',
  'updated_at',
].join(',');
const AU_MODEL_ROUTING_COLUMNS =
  'id,model_id,display_name,provider,registry,is_active,tier_required,priority,metadata,created_at,updated_at';

const CONFIG_WRITE_FIELDS = new Set([
  'billing_enabled',
  'free_chat_daily_limit',
  'free_exam_daily_limit',
  'free_upload_daily_limit',
  'free_max_upload_mb',
  'premium_models_paid_only',
  'stripe_price_weekly',
  'stripe_price_monthly',
  'stripe_price_weekly_id',
  'stripe_price_monthly_id',
  'bank_name',
  'bank_account_number',
  'bank_account_name',
  'bank_instructions',
  'alert_config',
]);

const SECRET_VALUE_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
  /\bsb_secret_[A-Za-z0-9_-]{12,}\b/g,
];

function maskProviderKey(raw: unknown): {
  configured: boolean;
  key_last4: string | null;
  key_fingerprint: string | null;
  key_label: string;
} {
  const key = String(raw || '').trim();
  if (!key) {
    return {
      configured: false,
      key_last4: null,
      key_fingerprint: null,
      key_label: 'Not configured',
    };
  }

  const last4 = key.slice(-4);
  const fingerprint = providerKeyFingerprint(key).slice(0, 12);
  return {
    configured: true,
    key_last4: last4,
    key_fingerprint: fingerprint,
    key_label: `Configured ••••${last4}`,
  };
}

function sanitizeProviderKeyRow(row: any) {
  const rawKey = String(row?.key_value || '').trim();
  const last4 = typeof row?.key_last4 === 'string' && row.key_last4.trim()
    ? row.key_last4.trim().slice(-4)
    : null;
  const fingerprint = typeof row?.key_fingerprint === 'string' && row.key_fingerprint.trim()
    ? row.key_fingerprint.trim().slice(0, 12)
    : null;
  const masked = rawKey
    ? maskProviderKey(rawKey)
    : {
        configured: Boolean(last4 || fingerprint),
        key_last4: last4,
        key_fingerprint: fingerprint,
        key_label: last4 ? `Configured ••••${last4}` : (fingerprint ? 'Configured' : 'Not configured'),
      };
  return {
    service: row?.service ?? null,
    provider_type: row?.provider_type ?? 'openrouter',
    is_active: row?.is_active !== false,
    allowed_models: Array.isArray(row?.allowed_models) ? row.allowed_models : row?.allowed_models ?? null,
    metadata: redactLogValue(row?.metadata && typeof row.metadata === 'object' ? row.metadata : {}, 'metadata'),
    error_count: Number(row?.error_count || 0),
    last_used_at: row?.last_used_at ?? null,
    rotated_at: row?.rotated_at ?? null,
    revoked_at: row?.revoked_at ?? null,
    created_at: row?.created_at ?? null,
    updated_at: row?.updated_at ?? null,
    ...masked,
  };
}

function hasNewProviderKeyValue(value: unknown): boolean {
  return String(value || '').trim().length > 0;
}

function redactLogValue(value: unknown, keyHint = '', depth = 0): unknown {
  const lowered = String(keyHint || '').toLowerCase();
  if (
    lowered.includes('authorization') ||
    lowered.includes('token') ||
    lowered.includes('secret') ||
    lowered.includes('api_key') ||
    lowered.includes('key_value') ||
    lowered.includes('provider_key') ||
    lowered.includes('prompt') ||
    lowered.includes('documentcontent') ||
    lowered.includes('document_content') ||
    lowered === 'preview'
  ) {
    return '[REDACTED]';
  }

  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const redacted = SECRET_VALUE_PATTERNS.reduce(
      (next, pattern) => next.replace(pattern, '[REDACTED_SECRET]'),
      value,
    );
    return redacted.length > 300 ? `${redacted.slice(0, 300)}...` : redacted;
  }
  if (depth >= 4) return '[REDACTED_DEPTH]';
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((entry) => redactLogValue(entry, keyHint, depth + 1));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        redactLogValue(entry, key, depth + 1),
      ]),
    );
  }
  return '[REDACTED]';
}

function sanitizeConexConfigRow(row: any) {
  if (!row || typeof row !== 'object') return {};
  return Object.fromEntries(
    AU_CONFIG_COLUMNS.split(',')
      .map((field) => [field, redactLogValue(row?.[field], field)] as const)
      .filter(([, value]) => value !== undefined),
  );
}

function sanitizeConexConfigPatch(config: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(config)
      .filter(([key]) => CONFIG_WRITE_FIELDS.has(key))
      .map(([key, value]) => [key, redactLogValue(value, key)]),
  );
}

async function auditProviderKeyChange(
  supabase: any,
  input: {
    action: 'create' | 'update' | 'revoke';
    service: string;
    providerType?: string | null;
    keyFingerprint?: string | null;
    actorUserId?: string | null;
  },
) {
  const { error } = await supabase
    .from('au_provider_key_audit_logs')
    .insert({
      action: input.action,
      service: input.service,
      provider_type: input.providerType || null,
      key_fingerprint: input.keyFingerprint || null,
      actor_user_id: input.actorUserId || null,
    });

  if (error && String(error?.code || '') !== '42P01') {
    console.warn('[admin/handler] provider key audit log write failed', {
      code: String(error?.code || ''),
    });
  }
}

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
        return await handleUpdateApiKey(supabase, body, requestId, adminResult.auth.userId);
      case 'delete_api_key':
        return await handleDeleteApiKey(supabase, body, requestId, adminResult.auth.userId);
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
    console.error(`[admin/handler] action=${action} failed:`, {
      code: String(error?.code || ''),
      message: String(redactLogValue(error?.message || 'Admin action failed.', 'message')),
    });
    return NextResponse.json(
      { error: 'handler_failed', message: 'Admin action failed.', requestId },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

// ─── Action Handlers ─────────────────────────────────────────────────────

async function handleGetConexConfig(supabase: any, requestId: string) {
  const { data, error } = await supabase
    .from('au_config')
    .select(AU_CONFIG_COLUMNS)
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
    { config: sanitizeConexConfigRow(data), requestId },
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

  const patch = sanitizeConexConfigPatch(config);
  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: 'empty_config', message: 'No supported config fields were provided.', requestId },
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
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
      .select(AU_CONFIG_COLUMNS)
      .maybeSingle();
  } else {
    result = await supabase
      .from('au_config')
      .insert(patch)
      .select(AU_CONFIG_COLUMNS)
      .maybeSingle();
  }

  if (result.error) throw result.error;

  return NextResponse.json(
    { ok: true, config: sanitizeConexConfigRow(result.data || patch), requestId },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}

async function handleGetRegistry(supabase: any, body: any, requestId: string) {
  const [keysResult, modelsResult] = await Promise.all([
    supabase.from('au_api_keys').select(PROVIDER_KEY_PUBLIC_COLUMNS).order('service'),
    supabase.from('au_model_routing').select(AU_MODEL_ROUTING_COLUMNS).order('model_id'),
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

  const keys = (keysResult.data || []).map(sanitizeProviderKeyRow);
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

async function handleUpdateApiKey(supabase: any, body: any, requestId: string, actorUserId?: string | null) {
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

  const newKeyValue = String(keyData.key_value || '').trim();
  const { data: existing, error: existingError } = await supabase
    .from('au_api_keys')
    .select('service,provider_type')
    .eq('service', service)
    .maybeSingle();
  if (existingError) {
    const code = String(existingError?.code || '');
    if (code !== '42P01') throw existingError;
  }

  if (!existing?.service && !hasNewProviderKeyValue(newKeyValue)) {
    return NextResponse.json(
      { error: 'missing_key_value', message: 'A new provider key value is required.', requestId },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const payload: Record<string, unknown> = {
    service,
    provider_type: String(keyData.provider_type || 'openrouter').trim() || 'openrouter',
    is_active: keyData.is_active !== false,
    allowed_models: Array.isArray(keyData.allowed_models) ? keyData.allowed_models : keyData.allowed_models ?? null,
    metadata: keyData.metadata && typeof keyData.metadata === 'object' ? keyData.metadata : {},
    updated_by: actorUserId || null,
    updated_at: new Date().toISOString(),
  };
  if (!existing?.service) {
    payload.created_by = actorUserId || null;
  }
  if (newKeyValue) {
    payload.encrypted_key_value = encryptProviderKey(newKeyValue);
    payload.key_encryption_version = 'app_aes_256_gcm_v1';
    payload.key_encrypted_at = new Date().toISOString();
    payload.key_value = null;
    payload.key_last4 = providerKeyLast4(newKeyValue);
    payload.key_fingerprint = providerKeyFingerprint(newKeyValue);
    payload.rotated_at = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from('au_api_keys')
    .upsert(payload, { onConflict: 'service' })
    .select(PROVIDER_KEY_PUBLIC_COLUMNS)
    .maybeSingle();

  if (error) throw error;
  await auditProviderKeyChange(supabase, {
    action: existing?.service ? 'update' : 'create',
    service,
    providerType: String(data?.provider_type || payload.provider_type || ''),
    keyFingerprint: typeof data?.key_fingerprint === 'string' ? data.key_fingerprint : null,
    actorUserId,
  });

  return NextResponse.json(
    { ok: true, key: sanitizeProviderKeyRow(data), requestId },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}

async function handleDeleteApiKey(supabase: any, body: any, requestId: string, actorUserId?: string | null) {
  const service = String(body?.service || '').trim();
  if (!service) {
    return NextResponse.json(
      { error: 'missing_service', message: 'Service name is required.', requestId },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const { data: existing } = await supabase
    .from('au_api_keys')
    .select('service,provider_type,key_fingerprint')
    .eq('service', service)
    .maybeSingle();

  const { error } = await supabase
    .from('au_api_keys')
    .update({
      key_value: null,
      encrypted_key_value: null,
      key_encryption_version: null,
      key_encrypted_at: null,
      key_reference: null,
      is_active: false,
      revoked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('service', service);

  if (error) throw error;
  await auditProviderKeyChange(supabase, {
    action: 'revoke',
    service,
    providerType: String(existing?.provider_type || ''),
    keyFingerprint: typeof existing?.key_fingerprint === 'string' ? existing.key_fingerprint : null,
    actorUserId,
  });

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
      .select('id,alert_config,updated_at')
      .maybeSingle();
  } else {
    result = await supabase
      .from('au_config')
      .insert({ alert_config: config })
      .select('id,alert_config,updated_at')
      .maybeSingle();
  }

  if (result.error) throw result.error;

  return NextResponse.json(
    { ok: true, requestId },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}

async function handleGetDebugLogs(supabase: any, requestId: string) {
  let result = await supabase
    .from('au_debug_logs')
    .select('id,level,source,component,message,details,created_at')
    .order('created_at', { ascending: false })
    .limit(200);

  if (result.error && String(result.error?.message || '').toLowerCase().includes('component')) {
    result = await supabase
      .from('au_debug_logs')
      .select('id,level,source,message,details,created_at')
      .order('created_at', { ascending: false })
      .limit(200);
  }

  const { data, error } = result;

  if (error) {
    const code = String(error?.code || '');
    if (code === '42P01') {
      // Table doesn't exist — return empty
      return NextResponse.json({ logs: [], requestId }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
    }
    throw error;
  }

  return NextResponse.json(
    {
      logs: (data || []).map((row: any) => ({
        ...row,
        message: redactLogValue(row?.message, 'message'),
        details: redactLogValue(row?.details, 'details'),
      })),
      requestId,
    },
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
