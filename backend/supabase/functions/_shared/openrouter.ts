import { getApiKey } from "./getApiKey.ts";

export const OPENROUTER_PROVIDER = "openrouter" as const;
export const OPENROUTER_CHAT_COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions";
export const OPENROUTER_EMBEDDINGS_URL = "https://openrouter.ai/api/v1/embeddings";

function getHttpReferer() {
  return Deno.env.get("OPENROUTER_HTTP_REFERER") ?? "https://datacube-au.vercel.app";
}

function getXTitle() {
  return Deno.env.get("OPENROUTER_X_TITLE") ?? "DataCube AU";
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

export async function openrouterChatCompletions(args: {
  supabaseAdmin: any;
  model: string;
  messages: OpenRouterChatMessage[];
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: "json_object" };
  requestId?: string;
}): Promise<{ content: string; usage: any | null; raw: any }>
{
  const resolvedProvider = Deno.env.get("AI_PROVIDER") ?? OPENROUTER_PROVIDER;
  assertProviderIsOpenRouter(resolvedProvider);

  const openRouterKey = await getOpenRouterKey(args.supabaseAdmin);
  const endpoint = OPENROUTER_CHAT_COMPLETIONS_URL;

  const model = args.model;

  console.log(
    `[openrouter] provider=${resolvedProvider} endpoint=${endpoint} model=${model}` +
      (args.requestId ? ` requestId=${args.requestId}` : ""),
  );

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openRouterKey}`,
      "HTTP-Referer": getHttpReferer(),
      "X-Title": getXTitle(),
    },
    body: JSON.stringify({
      model,
      messages: args.messages,
      temperature: typeof args.temperature === "number" ? args.temperature : 0.5,
      max_tokens: typeof args.max_tokens === "number" ? args.max_tokens : undefined,
      response_format: args.response_format,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter API Error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("Malformed OpenRouter response: missing content");
  }

  return { content, usage: data?.usage ?? null, raw: data };
}

export async function openrouterEmbeddings(args: {
  supabaseAdmin: any;
  model: string;
  input: string | string[];
  requestId?: string;
}): Promise<{ embeddings: number[][]; raw: any }>
{
  const resolvedProvider = Deno.env.get("AI_PROVIDER") ?? OPENROUTER_PROVIDER;
  assertProviderIsOpenRouter(resolvedProvider);

  const openRouterKey = await getOpenRouterKey(args.supabaseAdmin);
  const endpoint = OPENROUTER_EMBEDDINGS_URL;
  const model = args.model;

  console.log(
    `[openrouter] provider=${resolvedProvider} endpoint=${endpoint} model=${model}` +
      (args.requestId ? ` requestId=${args.requestId}` : ""),
  );

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openRouterKey}`,
      "HTTP-Referer": getHttpReferer(),
      "X-Title": getXTitle(),
    },
    body: JSON.stringify({
      model,
      input: args.input,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter Embedding Error: ${response.status} - ${errorText}`);
  }

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
