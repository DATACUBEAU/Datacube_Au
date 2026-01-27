import { getCorsHeaders, requireAnyAuth } from "../_shared/au.ts";
import { openrouterChatCompletions } from "../_shared/openrouter.ts";

type ChatRole = "system" | "user" | "assistant" | "tool";

type ChatMessage = {
  role: ChatRole;
  content: string;
};

function isChatMessageArray(value: unknown): value is ChatMessage[] {
  if (!Array.isArray(value)) return false;
  return value.every((m) => {
    if (!m || typeof m !== "object") return false;
    const role = (m as any).role;
    const content = (m as any).content;
    return (
      (role === "system" || role === "user" || role === "assistant" || role === "tool") &&
      typeof content === "string"
    );
  });
}

async function getDefaultModel(supabaseAdmin: any): Promise<string> {
  try {
    const { data: setting } = await supabaseAdmin
      .from("au_rag_settings")
      .select("value")
      .eq("key", "default_model")
      .single();

    if (setting?.value) {
      return typeof setting.value === "string"
        ? setting.value
        : JSON.stringify(setting.value).replace(/"/g, "");
    }
  } catch {
  }
  return "google/gemini-2.0-flash-exp:free";
}

async function assertValidGuestSession(supabaseAdmin: any, guestSessionId: string) {
  const { data, error } = await supabaseAdmin
    .from("au_guest_sessions")
    .select("id, expires_at")
    .eq("id", guestSessionId)
    .maybeSingle();

  if (error) {
    const err = new Error(`Guest session lookup failed: ${error.message}`) as any;
    err.status = 500;
    throw err;
  }

  if (!data?.id) {
    const err = new Error("Unauthorized: Invalid guest session") as any;
    err.status = 401;
    throw err;
  }

  if (data.expires_at) {
    const exp = new Date(data.expires_at).getTime();
    if (!Number.isNaN(exp) && exp < Date.now()) {
      const err = new Error("Unauthorized: Guest session expired") as any;
      err.status = 401;
      throw err;
    }
  }
}

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed", requestId }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const body = await req.json().catch(() => ({}));

    const auth = await requireAnyAuth(req, body);

    const authHeader = req.headers.get("Authorization");
    if (!auth.isGuest && !auth.isAdmin && !authHeader) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: Bearer token required", requestId }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (auth.isGuest) {
      await assertValidGuestSession(auth.supabaseAdmin, auth.userId as string);
    }

    const supabaseAdmin = auth.supabaseAdmin;

    const temperature =
      typeof body.temperature === "number" ? body.temperature : 0.5;
    const jsonMode = body.jsonMode === true || body.response_format === "json";
    const maxTokens = typeof body.max_tokens === "number" ? body.max_tokens : undefined;

    let messages: ChatMessage[] | null = null;
    if (isChatMessageArray(body.messages)) {
      messages = body.messages;
    } else if (typeof body.userPrompt === "string") {
      const systemPrompt = typeof body.systemPrompt === "string" ? body.systemPrompt : "";
      messages = [
        ...(systemPrompt ? [{ role: "system" as const, content: systemPrompt }] : []),
        { role: "user" as const, content: body.userPrompt },
      ];
    }

    if (!messages || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: "Missing messages", requestId }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const requestedModel = typeof body.model === "string" ? body.model : null;
    const model = requestedModel ?? (await getDefaultModel(supabaseAdmin));

    const { content, usage } = await openrouterChatCompletions({
      supabaseAdmin,
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      response_format: jsonMode ? { type: "json_object" } : undefined,
      requestId,
    });

    return new Response(
      JSON.stringify({
        ok: true,
        content,
        model,
        usage,
        requestId,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({
        error: error.message || "Internal server error",
        requestId,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: error.status || 500,
      },
    );
  }
});
