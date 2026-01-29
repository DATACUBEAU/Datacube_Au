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
  const allowedOriginsEnv = (Deno.env.get("ALLOWED_ORIGINS") ?? "").trim();
  const allowedOriginEnv = (Deno.env.get("ALLOWED_ORIGIN") ?? "*").trim();

  const allowedOrigins =
    allowedOriginsEnv.length > 0
      ? allowedOriginsEnv.split(",").map((s) => s.trim()).filter(Boolean)
      : allowedOriginEnv.split(",").map((s) => s.trim()).filter(Boolean);

  const allowsAny = allowedOrigins.includes("*");
  const isAllowed = !!origin && (allowsAny || allowedOrigins.includes(origin));

  const corsOrigin = isAllowed ? origin! : allowsAny ? (origin ?? "*") : (allowedOrigins[0] ?? "*");

  const headers: Record<string, string> = {
    ...corsHeaders,
    "Access-Control-Allow-Origin": corsOrigin,
    "Vary": "Origin",
  };

  if (corsOrigin !== "*") {
    headers["Access-Control-Allow-Credentials"] = "true";
  }

  if (origin && !isAllowed && !allowsAny) {
    const localhostOnly =
      allowedOrigins.length > 0 &&
      allowedOrigins.every((o) => o.startsWith("http://localhost") || o.startsWith("http://127.0.0.1"));
    if (localhostOnly && !origin.startsWith("http://localhost") && !origin.startsWith("http://127.0.0.1")) {
      console.warn(
        `[cors] Misconfiguration: only localhost origins are allowed, but request origin is ${origin}. ` +
          `Set ALLOWED_ORIGINS to include your production domain.`,
      );
    }
    console.warn(
      `[cors] Origin not allowed: ${origin}. Allowed: ${allowedOrigins.join(", ") || "(none)"}`,
    );
  }

  return headers;
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
                return { 
                  user: null, 
                  userId: null, 
                  isGuest: false,
                  isAdmin: false,
                  authError: "Token expired",
                  ownershipFilter: null,
                  supabaseClient: anonClient,
                  supabaseAdmin: getServiceClient()
                };
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
  model?: string
): Promise<number[]> {
  const { openrouterEmbeddings } = await import("./openrouter.ts");

  let resolvedModel = model;
  if (!resolvedModel) {
    try {
      const { data: setting } = await supabaseAdmin
        .from("au_rag_settings")
        .select("value")
        .eq("key", "embedding_model")
        .single();

      if (setting?.value) {
        resolvedModel = typeof setting.value === "string"
          ? setting.value
          : JSON.stringify(setting.value).replace(/"/g, "");
      }
    } catch {
    }
  }

  resolvedModel = resolvedModel || "google/gemini-2.0-flash-lite-preview-02-05:free";

  const { embeddings } = await openrouterEmbeddings({
    supabaseAdmin,
    model: resolvedModel,
    input,
  });

  if (!embeddings[0]) {
    throw new Error("Embedding generation failed: missing embedding");
  }

  return embeddings[0];
}

export async function callAU(
  supabaseAdmin: any,
  systemPrompt: string,
  userPrompt: string,
  temperature = 0.5,
  jsonMode = false,
  modelOverride?: string,
  usageContext?: { userId?: string; feature?: string; sessionId?: string; ownershipFilter?: any },
  scope = "chat"
): Promise<string> {
  const { openrouterChatCompletions } = await import("./openrouter.ts");
  const { getNextAvailableModelAsync, getVerifiedModelIds, reportModelHealth } = await import("./model_registry.ts");

  let model = modelOverride;
  if (!model) {
    try {
      const { data: setting } = await supabaseAdmin
        .from("au_rag_settings")
        .select("value")
        .eq("key", "default_model")
        .single();

      if (setting?.value) {
        model = typeof setting.value === "string"
          ? setting.value
          : JSON.stringify(setting.value).replace(/"/g, "");
      }
    } catch {
    }
  }

  model = model || "auto";

  // Retry loop for model fallback
  const verifiedModels = getVerifiedModelIds();
  const MAX_ATTEMPTS = Math.max(1, Math.min(verifiedModels.length, 20));
  let attempts = 0;
  let lastError: any = null;
  
  // Initialize currentModel. If "auto", pick one. If specific override, start there.
  let currentModel = model === "auto"
    ? await getNextAvailableModelAsync(supabaseAdmin, [], scope)
    : model;

  // Keep track of tried models in this session to avoid cycles
  const triedModels = new Set<string>();

  while (attempts < MAX_ATTEMPTS) {
    // If the current model has already been tried (e.g. from exclusion list in previous recursion or loop), get another one.
    if (triedModels.has(currentModel)) {
       currentModel = await getNextAvailableModelAsync(supabaseAdmin, Array.from(triedModels), scope);
    }
    
    // If no more models are available to try in the registry
    if (!currentModel) {
        break;
    }

    triedModels.add(currentModel);

    try {
      console.log(`[au.ts][${scope}] Attempt ${attempts + 1}/${MAX_ATTEMPTS} using model: ${currentModel} (JSON: ${jsonMode})`);
      
      const { content, usage, raw } = await openrouterChatCompletions({
        supabaseAdmin,
        model: currentModel,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature,
        response_format: jsonMode ? { type: "json_object" } : undefined,
      });

      // Report success for health scoring
      reportModelHealth(currentModel, true, undefined, scope);

      const feature = usageContext?.feature;
      if (usageContext?.ownershipFilter && feature && usage) {
        supabaseAdmin.from("au_model_usage").insert([
          {
            ...usageContext.ownershipFilter,
            feature,
            model_id: raw?.model || currentModel,
            prompt_tokens: typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : null,
            completion_tokens: typeof usage.completion_tokens === "number" ? usage.completion_tokens : null,
            total_tokens: typeof usage.total_tokens === "number" ? usage.total_tokens : null,
            cost: typeof usage.total_cost === "number" ? usage.total_cost : null,
            metadata: { sessionId: usageContext?.sessionId ?? null, usage },
          },
        ]).then(({ error }: any) => {
          if (error) console.error("[au.ts] Failed to log usage:", error);
        });
      }

      return content;

    } catch (err: any) {
      const status = err.status;
      const message = err.message || String(err);
      console.warn(`[au.ts][${scope}] Model ${currentModel} failed (Status: ${status}): ${message}`);
      lastError = err;

      // If it's a terminal configuration error (e.g. missing API key), don't retry other models
      if (message.includes("API key for") && message.includes("not found")) {
        console.error(`[au.ts] Terminal configuration error: ${message}`);
        throw err;
      }

      reportModelHealth(currentModel, false, typeof err?.status === "number" ? err.status : undefined, scope);
      
      // If we hit a rate limit (429), add a small delay before the next attempt
      if (status === 429) {
        const delay = 500 + Math.random() * 500; // 500-1000ms jitter
        console.log(`[au.ts] Rate limit hit on ${currentModel}. Waiting ${Math.round(delay)}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      // Get next best model, excluding all we have tried so far
      currentModel = await getNextAvailableModelAsync(supabaseAdmin, Array.from(triedModels), scope);
      attempts++;
    }
  }

  if (lastError) {
    console.warn(`[au.ts] Exhausted model attempts. Last error: ${lastError.message}`);
  }
  
  const lastErrorMessage = lastError?.message || "Exhausted all models";
  const finalError = new Error(`All AI models are currently unavailable. Last error: ${lastErrorMessage}`) as any;
  finalError.status = 503;
  finalError.details = lastErrorMessage;
  throw finalError;
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
