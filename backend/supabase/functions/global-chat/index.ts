/// <reference path="../deno.d.ts" />
// @ts-ignore: Deno modules
import {
  getCorsHeaders,
  callAUMessages,
  callAUStreamMessages,
  requireUser,
  emitEvent,
  logModelUsageEvent,
} from "../_shared/au.ts";
import { rateLimitOrThrow } from "../_shared/rate-limit.ts";
import {
  consumeUsageOrThrow,
  LimitExceededError,
  ProRequiredError,
  requireProEntitlementOrThrow,
} from "../_shared/usage-guard.ts";
import {
  readIdempotentResponse,
  writeIdempotentResponse,
  sha256Hex,
} from "../_shared/chat-cache.ts";
import { matchGlobalChatTemplate } from "../../../../shared/global-chat-routing.ts";
import { usageTrackingHandledByProxy } from "../_shared/usage-tracking.ts";
import {
  buildLayeredPrompt,
  normalizeConversationTurns,
  trimPromptText,
} from "../_shared/prompt-layering.ts";

function asTrimmedString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value == null) return "";
  return String(value).trim();
}

function normalizeMessages(raw: any): Array<{ role: "user" | "assistant" | "system"; content: string }> {
  return normalizeConversationTurns(raw?.messages, {
    maxTurns: 12,
    maxCharsPerTurn: 500,
  });
}

function latestUserInput(messages: Array<{ role: "user" | "assistant" | "system"; content: string }>): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "user") return messages[i].content;
  }
  return messages[messages.length - 1]?.content || "";
}

function normalizeGuide(raw: any): Record<string, unknown> {
  if (raw?.auGuide && typeof raw.auGuide === "object" && !Array.isArray(raw.auGuide)) {
    return raw.auGuide;
  }
  if (raw?.guide && typeof raw.guide === "object" && !Array.isArray(raw.guide)) {
    return raw.guide;
  }
  const textGuide = asTrimmedString(raw?.guide);
  if (textGuide) return { instructions: textGuide };
  return {};
}

function mergedGuidePreferences(
  row: any,
  requestGuide: Record<string, unknown>,
): {
  tone: string;
  verbosity: string;
  citations: boolean;
  answerScope: string;
  language: string;
  safety: string;
  instructions: string;
} {
  return {
    tone: asTrimmedString(requestGuide?.tone || row?.tone) || "friendly",
    verbosity: asTrimmedString(requestGuide?.verbosity || row?.verbosity) || "medium",
    citations: requestGuide?.citations === false ? false : row?.citations !== false,
    answerScope: asTrimmedString(requestGuide?.answer_scope || row?.answer_scope) || "general_allowed",
    language: asTrimmedString(requestGuide?.language || row?.language) || "english",
    safety: asTrimmedString(requestGuide?.safety || row?.safety) || "standard",
    instructions: asTrimmedString(requestGuide?.instructions || row?.instructions),
  };
}

function parseStructuredResponse(text: string): { answer: string; thought: string } {
  const cleaned = String(text || "")
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();
  if (!cleaned) return { answer: "", thought: "" };
  try {
    const parsed = JSON.parse(cleaned);
    return {
      answer: asTrimmedString(parsed?.answer) || cleaned,
      thought: asTrimmedString(parsed?.thought),
    };
  } catch {
    return {
      answer: cleaned,
      thought: "",
    };
  }
}

function toSseDoneResponse(
  payload: Record<string, unknown>,
  corsHeaders: Record<string, string>,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done", ...payload })}\n\n`));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}

function buildValidationIssues(input: { userInput: string }): Array<{ path: string; message: string; code: string }> {
  const issues: Array<{ path: string; message: string; code: string }> = [];
  if (!input.userInput) {
    issues.push({
      path: "messages|user_input",
      message: "Provide a non-empty user message in `messages` or `user_input`.",
      code: "too_small",
    });
  }
  return issues;
}

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  let corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-upsert, tus-resumable, upload-length, upload-metadata, upload-offset, x-correlation-id",
  };

  try {
    corsHeaders = getCorsHeaders(req);
  } catch (e) {
    console.warn("[global-chat] Failed to build CORS headers", e);
  }

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  let correlationId = requestId;

  try {
    const body = await req.json().catch(() => ({}));
    const messages = normalizeMessages(body);
    const requestGuide = normalizeGuide(body);
    const userInput =
      asTrimmedString(body?.user_input) ||
      asTrimmedString(body?.message) ||
      asTrimmedString(body?.prompt) ||
      latestUserInput(messages);
    const threadId =
      asTrimmedString(body?.thread_id) ||
      asTrimmedString(body?.sessionId) ||
      asTrimmedString(body?.session_id) ||
      "global";
    const idempotencyKey =
      asTrimmedString(body?.idempotencyKey) ||
      asTrimmedString(body?.idempotency_key);
    correlationId =
      asTrimmedString(req.headers.get("x-correlation-id")) ||
      asTrimmedString(body?.correlation_id) ||
      asTrimmedString(body?.correlationId) ||
      requestId;
    const wantsStream =
      body?.stream === true ||
      (req.headers.get("accept") || "").toLowerCase().includes("text/event-stream");

    const validationIssues = buildValidationIssues({ userInput });
    if (validationIssues.length > 0) {
      console.warn("[global-chat] payload validation failed", {
        requestId,
        correlationId,
        issues: validationIssues,
      });
      return new Response(
        JSON.stringify({
          error: "Invalid Payload",
          message: "Invalid Payload",
          status: 400,
          requestId,
          correlation_id: correlationId,
          details: { issues: validationIssues },
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const auth = await requireUser(req, body);
    const { userId, ownershipFilter, supabaseAdmin } = auth;

    if (auth.authError || !userId) {
      return new Response(
        JSON.stringify({
          error: "unauthorized",
          details: "Authentication failed",
          requestId,
          correlation_id: correlationId,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 },
      );
    }

    console.info("[global-chat] request received", {
      requestId,
      correlationId,
      userId,
      feature: "global_chat",
      threadId,
      idempotencyKey: idempotencyKey || null,
      messages_count: messages.length,
      preview: userInput.slice(0, 180),
    });

    const templateResponse = matchGlobalChatTemplate(userInput);
    if (templateResponse) {
      return new Response(
        JSON.stringify({
          ok: true,
          answer: templateResponse.answer,
          thought: "",
          citations: [],
          nav_action: templateResponse.navAction ?? null,
          sessionId: threadId,
          requestId,
          correlation_id: correlationId,
          delivered: true,
          messageIds: [],
          cache_hit: true,
          source: "template",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (idempotencyKey) {
      const prior = await readIdempotentResponse({
        supabaseAdmin,
        userId,
        feature: "global_chat",
        idempotencyKey,
        withinSeconds: 60,
      });
      if (prior?.response) {
        await logModelUsageEvent({
          supabaseAdmin,
          context: {
            userId,
            feature: "global_chat",
            sessionId: threadId,
            requestId,
            correlationId,
            cacheHit: true,
          },
          provider: "cache",
          model: "idempotency",
          usage: null,
          success: true,
          latencyMs: Date.now() - startedAt,
          metadata: {
            source: "au_request_idempotency",
            stream: wantsStream,
          },
        });
        if (wantsStream) {
          return toSseDoneResponse(prior.response || {}, corsHeaders);
        }
        return new Response(
          JSON.stringify({
            ...(prior.response || {}),
            idempotent: true,
            requestId,
            correlation_id: correlationId,
          }),
          { status: Number(prior.statusCode || 200), headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    await requireProEntitlementOrThrow(supabaseAdmin, userId, "global_chat");
    if (!usageTrackingHandledByProxy(req)) {
      await consumeUsageOrThrow(supabaseAdmin, userId, "au_chat", { countInc: 1 });
    }
    await rateLimitOrThrow(req, {
      endpoint: "global-chat",
      ownerId: userId,
      windowSeconds: 60,
      limit: 30,
    });

    const { data: preferences } = await supabaseAdmin
      .from("au_user_preferences")
      .select("tone,verbosity,citations,answer_scope,language,safety,instructions,updated_at")
      .eq("user_id", userId)
      .maybeSingle();

    const guide = mergedGuidePreferences(preferences, requestGuide);
    const memoryPack = body?.memory_pack && typeof body.memory_pack === "object" ? body.memory_pack : {};
    const recentSnippet = body?.recent_snippet && typeof body.recent_snippet === "object"
      ? body.recent_snippet
      : { mode: "turns", turns: [] };
    const appContext = body?.app_context && typeof body.app_context === "object" ? body.app_context : {};

    const digest = trimPromptText(asTrimmedString(memoryPack?.global_digest), 700);
    const profile = memoryPack?.profile || {};
    const goals = memoryPack?.goals || {};
    const activity = memoryPack?.au_activity_summary || {};

    let contextBlock = "";
    if (asTrimmedString(profile?.study_level)) contextBlock += `- study_level: ${asTrimmedString(profile.study_level)}\n`;
    if (asTrimmedString(profile?.exam_type)) contextBlock += `- exam_type: ${asTrimmedString(profile.exam_type)}\n`;
    if (asTrimmedString(profile?.country)) contextBlock += `- country: ${asTrimmedString(profile.country)}\n`;
    if (asTrimmedString(goals?.primary_goal)) contextBlock += `- primary_goal: ${asTrimmedString(goals.primary_goal)}\n`;
    if (asTrimmedString(goals?.target_exam_date_iso)) {
      contextBlock += `- target_exam_date_iso: ${asTrimmedString(goals.target_exam_date_iso)}\n`;
    }
    if (asTrimmedString(activity?.last_doc_title)) contextBlock += `- last_doc_title: ${asTrimmedString(activity.last_doc_title)}\n`;
    if (asTrimmedString(activity?.last_feature)) contextBlock += `- last_feature: ${asTrimmedString(activity.last_feature)}\n`;
    if (digest) contextBlock += `- memory_digest: ${digest}\n`;
    if (asTrimmedString(appContext?.current_page)) contextBlock += `- current_page: ${asTrimmedString(appContext.current_page)}\n`;

    let recentBlock = "";
    if (recentSnippet?.mode === "summary" && asTrimmedString(recentSnippet?.summary)) {
      recentBlock = trimPromptText(asTrimmedString(recentSnippet.summary), 800);
    } else if (Array.isArray(recentSnippet?.turns) && recentSnippet.turns.length > 0) {
      const turns = normalizeConversationTurns(recentSnippet.turns, {
        maxTurns: 8,
        maxCharsPerTurn: 280,
      })
        .map((turn) => `${String(turn.role || "user").toUpperCase()}: ${turn.content}`)
        .join("\n");
      if (turns) recentBlock = turns;
    }

    const layeredPrompt = buildLayeredPrompt({
      systemSections: [
        {
          label: "Role and mission",
          content: `You are Datacube AU Global Chat.
Handle app-wide questions, navigation, study planning, and general study support.
Keep answers concise, practical, and useful inside the product.`,
          maxChars: 520,
        },
        {
          label: "Non-negotiable rules",
          content: `Never claim access to private document chunks in Global Chat.
If the user needs document-grounded answers, direct them to AU Chat.
Prefer direct sentences over product copy.
Ask at most one clarifying question.
Avoid repeating the user's context back to them unless it is necessary.`,
          maxChars: 700,
        },
      ],
      developerSections: [
        {
          label: "Product controls",
          content: `Tone: ${guide.tone}
Verbosity: ${guide.verbosity}
Citations: ${guide.citations ? "on" : "off"}
Answer scope: ${guide.answerScope}
Language: ${guide.language}
Safety: ${guide.safety}
Return plain Markdown unless the user explicitly asks for another format.`,
          maxChars: 800,
        },
        ...(contextBlock
          ? [{
              label: "Known user and app context",
              content: contextBlock,
              maxChars: 1600,
            }]
          : []),
        ...(guide.instructions
          ? [{
              label: "Extra guide instructions",
              content: guide.instructions,
              maxChars: 1200,
            }]
          : []),
      ],
      userSections: [
        ...(recentBlock
          ? [{
              label: "Recent conversation context",
              content: recentBlock,
              maxChars: 1800,
            }]
          : []),
        {
          label: "Current user message",
          content: userInput,
          maxChars: 1800,
        },
      ],
      budget: {
        totalChars: 11000,
        systemChars: 2200,
        developerChars: 3600,
        userChars: 3200,
      },
    });

    const modelOverride =
      asTrimmedString(body?.model) ||
      asTrimmedString(req.headers.get("x-au-model")) ||
      undefined;
    const routedApiKey = asTrimmedString(req.headers.get("x-au-openrouter-key")) || undefined;

    if (wantsStream) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start: async (controller) => {
          const write = (obj: any) => {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
          };

          try {
            const { response } = await callAUStreamMessages(
              supabaseAdmin,
              layeredPrompt.messages,
              0.45,
              false,
              modelOverride,
              {
                userId,
                ownershipFilter,
                feature: "global_chat",
                sessionId: threadId,
                routedApiKey,
                requestId,
                correlationId,
                cacheHit: false,
              },
              "chat",
              requestId,
            );

            const bodyStream = response.body;
            if (!bodyStream) {
              write({ type: "error", error: "Missing upstream stream", requestId, correlation_id: correlationId });
              controller.close();
              return;
            }

            const reader = bodyStream.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            let fullText = "";

            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });

              const lines = buffer.split("\n");
              buffer = lines.pop() ?? "";

              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith("data:")) continue;
                const data = trimmed.slice(5).trim();
                if (!data) continue;
                if (data === "[DONE]") {
                  buffer = "";
                  break;
                }
                try {
                  const parsed = JSON.parse(data);
                  const delta = parsed?.choices?.[0]?.delta?.content;
                  if (typeof delta === "string" && delta) {
                    fullText += delta;
                    write({ type: "delta", text: delta });
                  }
                } catch {
                  // ignore malformed delta frame
                }
              }
            }

            const finalParsed = parseStructuredResponse(fullText);
            const responsePayload = {
              answer: finalParsed.answer || fullText,
              thought: finalParsed.thought || "",
              citations: [] as any[],
              sessionId: threadId,
              requestId,
              correlation_id: correlationId,
              delivered: true,
              messageIds: [],
            };

            if (idempotencyKey) {
              const requestHash = await sha256Hex(`${threadId}:${userInput}`);
              await writeIdempotentResponse({
                supabaseAdmin,
                userId,
                feature: "global_chat",
                idempotencyKey,
                requestHash,
                response: responsePayload,
                statusCode: 200,
                requestId,
                correlationId,
                ttlSeconds: 60,
              });
            }

            write({ type: "done", ...responsePayload });

            await emitEvent(supabaseAdmin, {
              event_type: "chat_completed",
              entity_id: "global-session",
              user_id: userId,
              metadata: {
                mode: "global",
                streamed: true,
                length: String(responsePayload.answer || "").length,
                correlation_id: correlationId,
              },
            });

            controller.close();
          } catch (error: any) {
            write({
              type: "error",
              error: String(error?.message || "Streaming failed"),
              details: error?.details || null,
              requestId,
              correlation_id: correlationId,
              isThrottled: error?.isThrottled || false,
            });
            controller.close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          ...corsHeaders,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
        },
      });
    }

    const responseText = await callAUMessages(
      supabaseAdmin,
      layeredPrompt.messages,
      0.45,
      false,
      modelOverride,
      {
        userId,
        ownershipFilter,
        feature: "global_chat",
        sessionId: threadId,
        routedApiKey,
        requestId,
        correlationId,
        cacheHit: false,
      },
      "chat",
    );

    const parsed = parseStructuredResponse(responseText);
    const finalResponse = {
      ok: true,
      answer: parsed.answer || responseText,
      thought: parsed.thought || "",
      citations: [] as any[],
      sessionId: threadId,
      requestId,
      correlation_id: correlationId,
      delivered: true,
      messageIds: [],
    };

    if (idempotencyKey) {
      const requestHash = await sha256Hex(`${threadId}:${userInput}`);
      await writeIdempotentResponse({
        supabaseAdmin,
        userId,
        feature: "global_chat",
        idempotencyKey,
        requestHash,
        response: finalResponse,
        statusCode: 200,
        requestId,
        correlationId,
        ttlSeconds: 60,
      });
    }

    await emitEvent(supabaseAdmin, {
      event_type: "chat_completed",
      entity_id: "global-session",
      user_id: userId,
      metadata: {
        mode: "global",
        streamed: false,
        length: finalResponse.answer.length,
        correlation_id: correlationId,
      },
    });

    return new Response(JSON.stringify(finalResponse), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[global-chat] error", {
      requestId,
      correlationId,
      message: String(error?.message || error),
      details: error?.details || null,
    });

    if (error instanceof ProRequiredError || error?.name === "ProRequiredError") {
      return new Response(
        JSON.stringify({
          ...(error.context || {}),
          requestId,
          correlation_id: correlationId,
        }),
        { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (error instanceof LimitExceededError || error?.name === "LimitExceededError") {
      return new Response(
        JSON.stringify({
          ...(error.context || {}),
          requestId,
          correlation_id: correlationId,
        }),
        { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (error?.errorType === "rate_limit") {
      return new Response(
        JSON.stringify({
          error: String(error?.message || "Too many requests. Try again shortly."),
          isThrottled: true,
          retryAfter: Number(error?.retryAfter || 8),
          requestId,
          correlation_id: correlationId,
        }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const status = typeof error?.status === "number" ? error.status : 500;
    const safeMessage =
      status === 401
        ? "unauthorized"
        : status === 403
          ? "forbidden"
          : "Global Assistant Error";

    return new Response(
      JSON.stringify({
        error: safeMessage,
        details: String(error?.message || error || ""),
        requestId,
        correlation_id: correlationId,
      }),
      { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
