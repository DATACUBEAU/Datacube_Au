/// <reference path="../deno.d.ts" />
import { getCorsHeaders, requireAnyAuth, callAUMessages, getServiceClient } from "../_shared/au.ts";
import { getApiKey } from "../_shared/getApiKey.ts";

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();

  let corsHeaders: any = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-upsert, tus-resumable, upload-length, upload-metadata, upload-offset",
  };

  try {
    corsHeaders = getCorsHeaders(req);
  } catch {
  }

  const headers = { ...corsHeaders, "Content-Type": "application/json" };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { action, messages, model, modelOverride, temperature, jsonMode, feature, sessionId } = body;

    if (action === 'ping') {
      const supabaseAdmin = getServiceClient();
      const openRouterKey = await getApiKey(supabaseAdmin, 'openrouter');
      const pingModel = typeof model === 'string' && model.trim() ? model : (typeof modelOverride === 'string' ? modelOverride : "");
      if (!pingModel) {
        return new Response(JSON.stringify({ error: 'Model required for ping', requestId }), { status: 400, headers });
      }

      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openRouterKey}`,
          "HTTP-Referer": "https://datacube-au.vercel.app",
          "X-Title": "DataCube AU",
        },
        body: JSON.stringify({
          model: pingModel,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
        }),
      });

      return new Response(JSON.stringify({ ok: true, reachable: res.ok, status: res.ok ? 200 : res.status, model: pingModel, requestId }), { headers });
    }

    const { userId, ownershipFilter, supabaseAdmin, error: authError } = await requireAnyAuth(req, body);

    if (authError) {
      return new Response(JSON.stringify({ error: authError, details: "Authentication failed", requestId }), { status: 401, headers });
    }

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: 'Missing messages', details: 'messages must be a non-empty array', requestId }), { status: 400, headers });
    }

    const t = typeof temperature === 'number' ? temperature : 0.7;
    const jm = jsonMode === true;
    const override = typeof modelOverride === 'string' && modelOverride.trim() ? modelOverride : (typeof model === 'string' && model.trim() ? model : undefined);
    const ctxFeature = typeof feature === 'string' ? feature : 'model-call';

    const result = await callAUMessages(
      supabaseAdmin,
      messages,
      t,
      jm,
      override,
      { userId: userId || undefined, ownershipFilter, feature: ctxFeature, sessionId }
    );

    const provider = result.model.includes('/') ? result.model.split('/')[0] : 'unknown';
    console.log('[model-call] success', { model: result.model, provider, used_fallback: result.used_fallback, feature: ctxFeature, requestId });

    return new Response(JSON.stringify({ ok: true, content: result.content, model: result.model, provider, usedFallback: result.used_fallback, requestId, pipeline: 'model-call' }), { headers });
  } catch (error: any) {
    const status = typeof error?.status === 'number' ? error.status : 500;
    const errorType = status === 429
      ? 'rate_limit'
      : status === 402
      ? 'payment_required'
      : status === 404
      ? 'model_not_found'
      : status === 400
      ? 'bad_request'
      : status === 401 || status === 403
      ? 'auth'
      : 'unknown';
    console.error(`[model-call] Error [${requestId}]:`, error);
    return new Response(JSON.stringify({ error: error?.message || 'Internal server error', errorType, details: error?.stack || String(error), requestId, pipeline: 'model-call' }), { status, headers });
  }
});
