import { getApiKey } from "./getApiKey.ts";
import { fetchWithTimeout } from "./au.ts";

export const OPENROUTER_PROVIDER = "openrouter" as const;
const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

function normalizeBaseUrl(value: string | null | undefined, fallback: string): string {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  return raw.replace(/\/+$/, "");
}

function normalizePath(value: string | null | undefined, fallback: string): string {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  return raw.startsWith("/") ? raw : `/${raw}`;
}

const OPENROUTER_BASE_URL = normalizeBaseUrl(
  Deno.env.get("OPENROUTER_BASE_URL"),
  DEFAULT_OPENROUTER_BASE_URL,
);
const OPENROUTER_CHAT_COMPLETIONS_PATH = normalizePath(
  Deno.env.get("OPENROUTER_CHAT_COMPLETIONS_PATH"),
  "/chat/completions",
);
const OPENROUTER_EMBEDDINGS_PATH = normalizePath(
  Deno.env.get("OPENROUTER_EMBEDDINGS_PATH"),
  "/embeddings",
);
const OPENROUTER_MODELS_PATH = normalizePath(
  Deno.env.get("OPENROUTER_MODELS_PATH"),
  "/models/user",
);

const RETRY_BASE_DELAY_MS = Math.max(200, Number(Deno.env.get("OPENROUTER_RETRY_BASE_MS") || 400));
const RETRY_MAX_ATTEMPTS = Math.max(0, Number(Deno.env.get("OPENROUTER_RETRY_ATTEMPTS") || 2));
const MODELS_CACHE_TTL_MS = Math.max(30_000, Number(Deno.env.get("OPENROUTER_MODELS_CACHE_TTL_MS") || 5 * 60_000));

export const OPENROUTER_CHAT_COMPLETIONS_URL = `${OPENROUTER_BASE_URL}${OPENROUTER_CHAT_COMPLETIONS_PATH}`;
export const OPENROUTER_EMBEDDINGS_URL = `${OPENROUTER_BASE_URL}${OPENROUTER_EMBEDDINGS_PATH}`;
export const OPENROUTER_MODELS_URL = `${OPENROUTER_BASE_URL}${OPENROUTER_MODELS_PATH}`;
export const OPENROUTER_MODELS_FALLBACK_URL = `${OPENROUTER_BASE_URL}/models`;

type ParsedErrorBody = {
  message?: string;
  error?: { message?: string; code?: string } | string;
  code?: string;
  [key: string]: unknown;
};

type UserModelsCacheState = {
  keySuffix: string;
  expiresAt: number;
  models: string[];
} | null;

let userModelsCache: UserModelsCacheState = null;

function getHttpReferer() {
  return Deno.env.get("OPENROUTER_HTTP_REFERER") ?? "https://datacube-au.vercel.app";
}

function getXTitle() {
  return Deno.env.get("OPENROUTER_X_TITLE") ?? "DataCube AU";
}

function maskApiKey(apiKey: string | null | undefined): string {
  const value = String(apiKey || "").trim();
  if (!value) return "missing";
  if (value.length <= 12) return `${value.slice(0, 3)}...`;
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

function toErrorText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncate(value: string, max = 1600): string {
  if (!value) return "";
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function parseJsonSafe(raw: string): ParsedErrorBody | null {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as ParsedErrorBody;
  } catch {
  }
  return null;
}

function isLikelyModelNotFound(status: number, rawBody: string, parsedBody: ParsedErrorBody | null): boolean {
  if (status !== 404) return false;
  const text = `${rawBody} ${toErrorText(parsedBody)}`.toLowerCase();
  return (
    (text.includes("model") && text.includes("not found")) ||
    text.includes("no endpoints found") ||
    text.includes("unknown model") ||
    text.includes("is not available")
  );
}

function isLikelyTransient404(status: number, rawBody: string, parsedBody: ParsedErrorBody | null): boolean {
  if (status !== 404) return false;
  if (isLikelyModelNotFound(status, rawBody, parsedBody)) return false;
  const text = `${rawBody} ${toErrorText(parsedBody)}`.toLowerCase();
  return (
    text.includes("<html") ||
    text.includes("route") ||
    text.includes("path") ||
    text.includes("not found") ||
    text.includes("temporarily") ||
    text.includes("cloudflare")
  );
}

function shouldRetry(status: number, rawBody: string, parsedBody: ParsedErrorBody | null): boolean {
  if (status === 429 || status === 502 || status === 503 || status === 504) return true;
  if (status === 404 && isLikelyTransient404(status, rawBody, parsedBody)) return true;
  return false;
}

async function sleep(ms: number): Promise<void> {
  return await new Promise((resolve) => setTimeout(resolve, ms));
}

function extractErrorMessage(status: number, rawBody: string, parsedBody: ParsedErrorBody | null): string {
  const messageCandidate =
    parsedBody?.error && typeof parsedBody.error === "object"
      ? (parsedBody.error.message || parsedBody.error.code)
      : typeof parsedBody?.error === "string"
        ? parsedBody.error
        : undefined;
  const direct = parsedBody?.message || parsedBody?.code || messageCandidate;
  const suffix = typeof direct === "string" && direct.trim().length > 0
    ? direct.trim()
    : truncate(rawBody, 240);
  return suffix ? `OpenRouter API Error: ${status} - ${suffix}` : `OpenRouter API Error: ${status}`;
}

function parseCsvEnvList(value: string | null | undefined): string[] {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

const EMERGENCY_MODEL_HINTS = parseCsvEnvList(Deno.env.get("OPENROUTER_EMERGENCY_MODELS"));

function selectPreferredModels(
  available: string[],
  tier: "free" | "pro",
): string[] {
  if (!Array.isArray(available) || available.length === 0) return [];

  const unique = Array.from(new Set(available.filter((item) => typeof item === "string" && item.trim().length > 0)));

  const freeOnly = unique.filter((id) => id.endsWith(":free"));
  const pool = tier === "free" && freeOnly.length > 0 ? freeOnly : unique;
  if (EMERGENCY_MODEL_HINTS.length > 0) {
    const preferred = EMERGENCY_MODEL_HINTS.filter((id) => pool.includes(id));
    if (preferred.length > 0) return preferred;
  }

  return pool.slice(0, 8);
}

function isFallbackProviderEnabled(): boolean {
  const raw = String(Deno.env.get("AI_FALLBACK_ENABLED") || "true").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off" && raw !== "no";
}

function getFallbackProviderConfig() {
  const baseUrl = normalizeBaseUrl(
    Deno.env.get("FALLBACK_OPENAI_BASE_URL") ?? Deno.env.get("OPENAI_BASE_URL"),
    "https://api.openai.com/v1",
  );
  const apiKey = String(
    Deno.env.get("FALLBACK_OPENAI_API_KEY") ??
    Deno.env.get("OPENAI_API_KEY") ??
    "",
  ).trim();
  const model = String(Deno.env.get("FALLBACK_OPENAI_MODEL") || "gpt-4o-mini").trim();
  return { baseUrl, apiKey, model };
}

function buildModelsPayload(primaryModel: string, fallbackModels?: string[]): string[] | undefined {
  if (!Array.isArray(fallbackModels) || fallbackModels.length === 0) return undefined;
  const unique = Array.from(
    new Set(
      fallbackModels
        .filter((model) => typeof model === "string")
        .map((model) => model.trim())
        .filter((model) => model.length > 0),
    ),
  );
  if (!unique.includes(primaryModel)) {
    unique.unshift(primaryModel);
  }
  return unique.length > 1 ? unique : undefined;
}

export function assertProviderIsOpenRouter(provider: string): asserts provider is typeof OPENROUTER_PROVIDER {
  if (provider !== OPENROUTER_PROVIDER) {
    throw new Error(`Provider drift detected: expected openrouter, got ${provider}`);
  }
}

async function getOpenRouterKey(supabaseAdmin: any) {
  return await getApiKey(supabaseAdmin, OPENROUTER_PROVIDER);
}

export type OpenRouterChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
};

async function performOpenRouterRequest(args: {
  endpoint: string;
  apiKey: string;
  body: Record<string, unknown>;
  timeoutMs: number;
  requestId?: string;
  accept?: string;
}): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${args.apiKey}`,
    "HTTP-Referer": getHttpReferer(),
    "X-Title": getXTitle(),
  };
  if (args.accept) headers.Accept = args.accept;

  const requestBody = JSON.stringify(args.body);
  const maxAttempts = RETRY_MAX_ATTEMPTS + 1;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const response = await fetchWithTimeout(args.endpoint, {
      method: "POST",
      headers,
      body: requestBody,
      timeout: args.timeoutMs,
    });

    if (response.ok) return response;

    const rawBody = await response.text().catch(() => "");
    const parsedBody = parseJsonSafe(rawBody);
    const retriable = shouldRetry(response.status, rawBody, parsedBody);

    const diagnostic = {
      requestId: args.requestId || null,
      attempt: attempt + 1,
      maxAttempts,
      status: response.status,
      url: args.endpoint,
      retriable,
      apiKey: maskApiKey(args.apiKey),
      headers: {
        "content-type": headers["Content-Type"],
        "http-referer": headers["HTTP-Referer"],
        "x-title": headers["X-Title"],
        ...(headers.Accept ? { accept: headers.Accept } : {}),
      },
      requestBody: truncate(requestBody, 4000),
      responseBody: truncate(rawBody, 4000),
    };

    console.error("[openrouter] Request failed", diagnostic);

    if (retriable && attempt < maxAttempts - 1) {
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
      const jitter = Math.floor(Math.random() * 120);
      await sleep(delay + jitter);
      continue;
    }

    const error = new Error(extractErrorMessage(response.status, rawBody, parsedBody)) as any;
    error.status = response.status;
    error.details = {
      ...diagnostic,
      parsedBody,
      modelNotFound: isLikelyModelNotFound(response.status, rawBody, parsedBody),
    };
    if (response.status === 429 || response.status === 503 || response.status === 504) {
      error.isThrottled = true;
    }
    throw error;
  }

  throw new Error("OpenRouter request failed after retries.");
}

async function performOpenRouterGetRequest(args: {
  endpoint: string;
  apiKey: string;
  timeoutMs: number;
  requestId?: string;
}): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${args.apiKey}`,
    "HTTP-Referer": getHttpReferer(),
    "X-Title": getXTitle(),
  };
  return await fetchWithTimeout(args.endpoint, {
    method: "GET",
    headers,
    timeout: args.timeoutMs,
  });
}

export function isModelNotFoundError(error: any): boolean {
  if (!error) return false;
  if (Number(error?.status) !== 404) return false;
  const detailsText = toErrorText(error?.details).toLowerCase();
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("model") && message.includes("not found") ||
    detailsText.includes("modelnotfound") ||
    detailsText.includes("model not found") ||
    detailsText.includes("no endpoints found") ||
    detailsText.includes("unknown model")
  );
}

export async function listAvailableUserModelIds(
  apiKey: string,
  requestId?: string,
): Promise<string[]> {
  const suffix = maskApiKey(apiKey);
  const now = Date.now();
  if (userModelsCache && userModelsCache.keySuffix === suffix && userModelsCache.expiresAt > now) {
    return userModelsCache.models;
  }

  let response = await performOpenRouterGetRequest({
    endpoint: OPENROUTER_MODELS_URL,
    apiKey,
    timeoutMs: 20_000,
    requestId,
  });

  if (!response.ok) {
    const rawBody = await response.text().catch(() => "");
    console.warn("[openrouter] Failed to fetch /models/user", {
      requestId: requestId || null,
      status: response.status,
      url: OPENROUTER_MODELS_URL,
      body: truncate(rawBody, 1200),
    });

    if (response.status === 404 && OPENROUTER_MODELS_URL !== OPENROUTER_MODELS_FALLBACK_URL) {
      response = await performOpenRouterGetRequest({
        endpoint: OPENROUTER_MODELS_FALLBACK_URL,
        apiKey,
        timeoutMs: 20_000,
        requestId,
      });
      if (!response.ok) {
        const fallbackBody = await response.text().catch(() => "");
        console.warn("[openrouter] Fallback /models request failed", {
          requestId: requestId || null,
          status: response.status,
          url: OPENROUTER_MODELS_FALLBACK_URL,
          body: truncate(fallbackBody, 1200),
        });
        return [];
      }
    } else {
      return [];
    }
  }

  const data = await response.json().catch(() => null);
  const models = Array.isArray((data as any)?.data)
    ? (data as any).data
        .map((row: any) => String(row?.id || "").trim())
        .filter((id: string) => id.length > 0)
    : [];

  userModelsCache = {
    keySuffix: suffix,
    models,
    expiresAt: now + MODELS_CACHE_TTL_MS,
  };
  return models;
}

export function getEmergencyModelCandidates(
  available: string[],
  tier: "free" | "pro",
): string[] {
  return selectPreferredModels(available, tier);
}

export type FallbackChatResult = {
  content: string;
  usage: any | null;
  raw: any;
  provider: "openai-compatible";
  model: string;
};

export async function fallbackChatCompletions(args: {
  messages: OpenRouterChatMessage[];
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: "json_object" };
  requestId?: string;
}): Promise<FallbackChatResult> {
  if (!isFallbackProviderEnabled()) {
    const err = new Error("Fallback provider disabled. Set AI_FALLBACK_ENABLED=true to enable.");
    (err as any).status = 503;
    throw err;
  }

  const config = getFallbackProviderConfig();
  if (!config.apiKey) {
    const err = new Error(
      "Fallback provider unavailable: missing FALLBACK_OPENAI_API_KEY/OPENAI_API_KEY.",
    );
    (err as any).status = 503;
    throw err;
  }

  const endpoint = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const body = {
    model: config.model,
    messages: args.messages,
    temperature: typeof args.temperature === "number" ? args.temperature : 0.5,
    max_tokens: typeof args.max_tokens === "number" ? args.max_tokens : undefined,
    response_format: args.response_format,
  };

  const response = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
    timeout: 120_000,
  });

  if (!response.ok) {
    const rawBody = await response.text().catch(() => "");
    console.error("[fallback-ai] Request failed", {
      requestId: args.requestId || null,
      status: response.status,
      endpoint,
      model: config.model,
      body: truncate(rawBody, 1200),
    });
    const err = new Error(`Fallback provider error: ${response.status}`) as any;
    err.status = response.status;
    err.details = rawBody;
    throw err;
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    const err = new Error("Fallback provider returned malformed response.") as any;
    err.status = 502;
    err.details = data;
    throw err;
  }

  console.warn("[fallback-ai] Served response using fallback provider", {
    requestId: args.requestId || null,
    endpoint,
    model: config.model,
  });

  return {
    content,
    usage: data?.usage ?? null,
    raw: data,
    provider: "openai-compatible",
    model: config.model,
  };
}

export function buildSyntheticSseResponseFromText(text: string): Response {
  const encoder = new TextEncoder();
  const safeText = String(text || "");
  const chunks = safeText.match(/.{1,120}/g) ?? [];

  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        const payload = {
          choices: [{ delta: { content: chunk } }],
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}

export async function openrouterChatCompletions(args: {
  supabaseAdmin: any;
  model: string;
  models?: string[]; // Optional fallback list
  messages: OpenRouterChatMessage[];
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: "json_object" };
  requestId?: string;
  apiKey?: string; // New optional parameter
}): Promise<{ content: string; usage: any | null; raw: any }>
{
  const resolvedProvider = Deno.env.get("AI_PROVIDER") ?? OPENROUTER_PROVIDER;
  assertProviderIsOpenRouter(resolvedProvider);

  const openRouterKey = args.apiKey || await getOpenRouterKey(args.supabaseAdmin);
  const endpoint = OPENROUTER_CHAT_COMPLETIONS_URL;
  const modelsPayload = buildModelsPayload(args.model, args.models);
  const requestBody = {
    model: args.model,
    ...(modelsPayload ? { models: modelsPayload } : {}),
    messages: args.messages,
    temperature: typeof args.temperature === "number" ? args.temperature : 0.5,
    max_tokens: typeof args.max_tokens === "number" ? args.max_tokens : undefined,
    response_format: args.response_format,
    provider: {
      order: ["OpenAI", "Anthropic", "Google", "Mistral"],
      allow_fallbacks: true,
    },
  };

  console.log(
    `[openrouter] provider=${resolvedProvider} endpoint=${endpoint} model=${args.model}` +
      (modelsPayload ? ` fallback_count=${modelsPayload.length}` : "") +
      (args.requestId ? ` requestId=${args.requestId}` : ""),
  );

  const response = await performOpenRouterRequest({
    endpoint,
    apiKey: openRouterKey,
    body: requestBody,
    timeoutMs: 120_000,
    requestId: args.requestId,
  });

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("Malformed OpenRouter response: missing content");
  }

  return { content, usage: data?.usage ?? null, raw: data };
}

export async function openrouterChatCompletionsStream(args: {
  supabaseAdmin: any;
  model: string;
  models?: string[];
  messages: OpenRouterChatMessage[];
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: "json_object" };
  requestId?: string;
  apiKey?: string;
}): Promise<Response> {
  const resolvedProvider = Deno.env.get("AI_PROVIDER") ?? OPENROUTER_PROVIDER;
  assertProviderIsOpenRouter(resolvedProvider);

  const openRouterKey = args.apiKey || await getOpenRouterKey(args.supabaseAdmin);
  const endpoint = OPENROUTER_CHAT_COMPLETIONS_URL;
  const modelsPayload = buildModelsPayload(args.model, args.models);
  const requestBody = {
    model: args.model,
    ...(modelsPayload ? { models: modelsPayload } : {}),
    messages: args.messages,
    temperature: typeof args.temperature === "number" ? args.temperature : 0.5,
    max_tokens: typeof args.max_tokens === "number" ? args.max_tokens : undefined,
    response_format: args.response_format,
    stream: true,
    provider: {
      order: ["OpenAI", "Anthropic", "Google", "Mistral"],
      allow_fallbacks: true,
    },
  };

  console.log(
    `[openrouter] provider=${resolvedProvider} endpoint=${endpoint} model=${args.model}` +
      (modelsPayload ? ` fallback_count=${modelsPayload.length}` : "") +
      (args.requestId ? ` requestId=${args.requestId}` : ""),
  );

  const response = await performOpenRouterRequest({
    endpoint,
    apiKey: openRouterKey,
    body: requestBody,
    timeoutMs: 120_000,
    requestId: args.requestId,
    accept: "text/event-stream",
  });

  return response;
}

export async function openrouterEmbeddings(args: {
  supabaseAdmin: any;
  model: string;
  input: string | string[];
  requestId?: string;
  apiKey?: string; // New optional parameter
}): Promise<{ embeddings: number[][]; raw: any }>
{
  const resolvedProvider = Deno.env.get("AI_PROVIDER") ?? OPENROUTER_PROVIDER;
  assertProviderIsOpenRouter(resolvedProvider);

  const openRouterKey = args.apiKey || await getOpenRouterKey(args.supabaseAdmin);
  const endpoint = OPENROUTER_EMBEDDINGS_URL;
  const model = args.model;

  const maskedKey = openRouterKey ? `${openRouterKey.substring(0, 8)}...` : "undefined";
  console.log(
    `[openrouter] provider=${resolvedProvider} endpoint=${endpoint} model=${model} key=${maskedKey}` +
      (args.requestId ? ` requestId=${args.requestId}` : ""),
  );

  const response = await performOpenRouterRequest({
    endpoint,
    apiKey: openRouterKey,
    body: {
      model,
      input: args.input,
    },
    timeoutMs: 30_000,
    requestId: args.requestId,
  });

  const data = await response.json();
  const items = Array.isArray(data?.data) ? data.data : null;
  if (!items || items.length === 0) {
    throw new Error("Malformed OpenRouter embeddings response: missing data[]");
  }

  const embeddings: number[][] = [];
  for (const item of items) {
    if (!item || !Array.isArray(item.embedding)) {
      throw new Error("Malformed OpenRouter embeddings response: missing embedding");
    }
    embeddings.push(item.embedding);
  }

  return { embeddings, raw: data };
}
