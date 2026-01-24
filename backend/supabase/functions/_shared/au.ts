// @ts-ignore: Deno modules
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { getApiKey } from "./getApiKey.ts";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-upsert, tus-resumable, upload-length, upload-metadata, upload-offset",
};

export function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin");
  const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN") || "*";
  const corsOrigin = (allowedOrigin === "*" || allowedOrigin === origin) 
    ? (origin || "*") 
    : allowedOrigin;

  return {
    ...corsHeaders,
    "Access-Control-Allow-Origin": corsOrigin,
    "Access-Control-Allow-Credentials": "true",
  };
}

/**
 * Creates a Supabase client with service_role permissions.
 * Use this only for server-side operations that require bypassing RLS.
 */
export function getServiceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );
}

/**
 * Validates authentication from request headers and body
 * Supports Supabase Auth and Guest Session fallback
 * Returns user info and a filter helper for manual ownership checks
 */
export async function validateAuth(req: Request, body?: any) {
  const authHeader = req.headers.get("Authorization");
  
  const anonClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: authHeader ? { Authorization: authHeader } : {} } }
  );

  let user: any = null;
  let userId: string | null = null;
  let isGuest = false;
  let isAdmin = false;
  let authError: string | null = null;

  if (authHeader) {
    const token = authHeader.replace("Bearer ", "");
    
    // 0. Check if it's the Service Role Key directly (often used in local dev or simple scripts)
    if (token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) {
      isAdmin = true;
      // We use a valid UUID for the service role user to satisfy UUID constraints in DB
      userId = "00000000-0000-0000-0000-000000000000"; 
      user = { id: userId, role: "service_role" };
    }

    // 1. Try Supabase Auth first
    if (!isAdmin) {
      try {
        const { data: authData, error: getUserError } = await anonClient.auth.getUser();
        if (authData?.user) {
          user = authData.user;
          userId = authData.user.id;
          isAdmin = authData.user.app_metadata?.role === 'admin' || 
                    authData.user.user_metadata?.role === 'admin' ||
                    authData.user.role === 'service_role';
          authError = null; // Clear any previous error if we found a user
        } else if (getUserError && !token.includes('.') && token !== Deno.env.get("SUPABASE_ANON_KEY")) {
          // Only treat as error if it's not a guest token or anon key
          authError = getUserError.message;
        }
      } catch (err) {
        console.warn(`[shared-auth] auth.getUser() error:`, (err as Error).message);
      }
    }

    if (!userId) {
      // 2. Fallback: Manual JWT decode for guest tokens or service_role tokens
      try {
        if (token && token.includes('.')) {
          const parts = token.split(".");
          if (parts.length === 3) {
            const payload = parts[1];
            const padded = payload.padEnd(payload.length + (4 - (payload.length % 4)) % 4, '=');
            const decoded = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
            if (decoded) {
              const decodedPayload = JSON.parse(decoded);
              userId = decodedPayload.sub || decodedPayload.guest_session_id || null;
              
              if (decodedPayload.exp && Date.now() / 1000 > decodedPayload.exp) {
                return { user: null, userId: null, error: "Token expired" };
              }

              // Check for admin/service_role in JWT claims
              if (decodedPayload.role === 'service_role' || decodedPayload.role === 'admin') {
                isAdmin = true;
              }

              if (userId) {
                user = { id: userId, is_anonymous: !isAdmin, role: decodedPayload.role };
                isGuest = !isAdmin && (!!decodedPayload.guest_session_id || !decodedPayload.sub);
                authError = null; // Clear error if we found a session via JWT
              }
            }
          }
        }
      } catch (err) {
        console.warn(`[shared-auth] Token decode warning:`, (err as Error).message);
      }
    }
  }

  // 3. Final Fallback: guestSessionId from request body
  if (!userId && body?.guestSessionId) {
    userId = body.guestSessionId;
    user = { id: userId, is_anonymous: true };
    isGuest = true;
    authError = null; // Clear error if we found a guest session via body
  }

  // 4. Extra fallback for userId in body
  if (!userId && body?.userId) {
    userId = body.userId;
    user = { id: userId, is_anonymous: true };
    isGuest = true;
  }

  // ownershipFilter helper for manual RLS enforcement
  // If we still don't have a userId, we might want to allow it if RLS is disabled, 
  // but for now let's keep it required for ownership tracking.
  const ownershipFilter = userId ? (isGuest ? { guest_session_id: userId } : { user_id: userId }) : null;
  
  if (!userId) {
    console.warn("[shared-auth] No userId found in headers, JWT, or body");
  }

  return { 
    user, 
    userId, 
    isGuest,
    isAdmin,
    authError,
    ownershipFilter,
    supabaseClient: anonClient, // Client with user context (if needed)
    supabaseAdmin: getServiceClient() // Service role client for bypassing RLS
  };
}

/**
 * Enforces admin-only access
 * Throws a response error if not admin
 */
export async function requireAdmin(req: Request, body?: any) {
  const auth = await validateAuth(req, body);
  if (auth.authError) {
    const err = new Error(auth.authError) as any;
    err.status = 401;
    throw err;
  }
  if (!auth.isAdmin) {
    const err = new Error("Forbidden: Admin access required") as any;
    err.status = 403;
    throw err;
  }
  return auth;
}

/**
 * Enforces authenticated user access (no guests)
 */
export async function requireUser(req: Request, body?: any) {
  const auth = await validateAuth(req, body);
  if (auth.authError) {
    const err = new Error(auth.authError) as any;
    err.status = 401;
    throw err;
  }
  if (!auth.userId || auth.isGuest) {
    const err = new Error("Unauthorized: Registered user account required") as any;
    err.status = 401;
    throw err;
  }
  return auth;
}

/**
 * Enforces any valid session (guest or user)
 */
export async function requireAnyAuth(req: Request, body?: any) {
  const auth = await validateAuth(req, body);
  if (auth.authError) {
    const err = new Error(auth.authError) as any;
    err.status = 401;
    throw err;
  }
  if (!auth.userId) {
    const err = new Error("Unauthorized: Session required") as any;
    err.status = 401;
    throw err;
  }
  return auth;
}

export interface AUResponse {
  text: string;
}

export async function generateEmbedding(
  supabaseAdmin: any,
  input: string,
  model = "text-embedding-ada-002"
): Promise<number[]> {
  // 1. Try OpenAI First
  try {
    const openAiKey = await getApiKey(supabaseAdmin, "openai");
    
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openAiKey}`,
      },
      body: JSON.stringify({
        input,
        model,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      return data.data[0].embedding;
    } else {
      console.warn(`[au.ts] OpenAI Embedding failed: ${response.status} ${response.statusText}`);
    }
  } catch (e) {
    console.warn(`[au.ts] OpenAI Embedding error:`, e);
  }

  // 2. Fallback to OpenRouter (if OpenAI fails or key missing)
  try {
    console.log("[au.ts] Falling back to OpenRouter for embedding...");
    const openRouterKey = await getApiKey(supabaseAdmin, "openrouter");
    
    // OpenRouter Embedding Endpoint
    const response = await fetch("https://openrouter.ai/api/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openRouterKey}`,
        "HTTP-Referer": "https://datacube-au.vercel.app",
        "X-Title": "DataCube AU",
      },
      body: JSON.stringify({
        input,
        model: "text-embedding-ada-002", // OpenRouter maps this often, or we could use 'openai/text-embedding-ada-002'
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter Embedding Error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return data.data[0].embedding;
  } catch (e: any) {
    console.error("[au.ts] All embedding providers failed.");
    throw new Error(`Embedding generation failed: ${e.message}`);
  }
}

export async function callAU(
  supabaseAdmin: any,
  systemPrompt: string,
  userPrompt: string,
  temperature = 0.5,
  jsonMode = false,
  modelOverride?: string,
  usageContext?: { userId?: string; feature?: string; sessionId?: string; ownershipFilter?: any }
): Promise<string> {
  const openRouterKey = await getApiKey(supabaseAdmin, "openrouter");
  
  // 1. Check for Model Override or Default from DB
  let model = modelOverride;

  if (!model) {
      // Try to fetch default from DB, otherwise fallback to hardcoded approved model
      const { data: setting } = await supabaseAdmin
          .from('au_rag_settings')
          .select('value')
          .eq('key', 'default_model')
          .single();
      
      if (setting && setting.value) {
          model = typeof setting.value === 'string' ? setting.value : JSON.stringify(setting.value).replace(/"/g, '');
      } else {
          // Fallback to one of the approved free models
          model = "allenai/olmo-3.1-32b-think:free"; 
      }
  }

  // Ensure model is one of the approved ones (optional strict check, but we allow admin override)
  // Approved: 
  // - allenai/olmo-3.1-32b-think:free
  // - nvidia/nemotron-3-nano-30b-a3b:free
  // - mistralai/devstral-2512:free
  // - google/gemini-2.0-flash-exp:free (Previous default, keeping as fallback option if configured)

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openRouterKey}`,
      "HTTP-Referer": "https://datacube-au.vercel.app",
      "X-Title": "DataCube AU",
    },
    body: JSON.stringify({
      model: model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: temperature,
      response_format: jsonMode ? { type: "json_object" } : undefined,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter API Error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const usage = (data as any)?.usage;
  const feature = usageContext?.feature;
  if (usageContext?.ownershipFilter && feature && usage) {
    await supabaseAdmin.from('au_model_usage').insert([
      {
        ...usageContext.ownershipFilter,
        feature,
        model_id: model,
        prompt_tokens: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : null,
        completion_tokens: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : null,
        total_tokens: typeof usage.total_tokens === 'number' ? usage.total_tokens : null,
        cost: typeof usage.total_cost === 'number' ? usage.total_cost : null,
        metadata: { sessionId: usageContext?.sessionId ?? null, usage },
      },
    ]);
  }
  return data.choices[0].message.content;
}

/**
 * Standardized Event Emission for the Sync Layer
 */
export async function emitEvent(
  supabaseAdmin: any,
  event: {
    event_type: 'document_uploaded' | 'document_deleted' | 'embedding_created' | 'vector_indexed' | 'chat_completed' | 'exam_generated' | 'prediction_generated';
    entity_id: string;
    user_id?: string | null;
    guest_session_id?: string | null;
    metadata?: any;
  }
) {
  const payload = {
    ...event,
    user_id: event.user_id || event.guest_session_id || 'anonymous',
    timestamp: new Date().toISOString(),
  };

  // 1. Persist to DB
  const { error } = await supabaseAdmin
    .from('au_events')
    .insert([payload]);

  if (error) {
    console.error(`[sync-layer] Failed to persist event ${event.event_type}:`, error.message);
  }

  // 2. Realtime Broadcast (Optional but recommended for frontend sync)
  // This would use Supabase Realtime Broadcast if configured
  
  return { success: !error, payload };
}
