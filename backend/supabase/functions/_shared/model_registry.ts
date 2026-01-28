
import { getApiKey } from "./getApiKey.ts";

export interface Model {
  id: string;
  tier: 1 | 2 | 3 | 4;
  name: string;
}

export const VERIFIED_FREE_MODELS: Model[] = [
  // Tier 1: Top Tier / Reasoning / Large
  { id: "deepseek/deepseek-r1", tier: 1, name: "DeepSeek R1" },
  { id: "phind/phind-codellama-34b", tier: 1, name: "Phind CodeLlama 34B" },
  { id: "microsoft/phi-3-medium-128k-instruct", tier: 1, name: "Phi-3 Medium" },
  
  // Tier 2: Mid Tier / Balanced
  { id: "deepseek/deepseek-chat", tier: 2, name: "DeepSeek Chat" },
  { id: "meta-llama/llama-3.1-8b-instruct", tier: 2, name: "Llama 3.1 8B" },
  { id: "meta-llama/llama-3-8b-instruct", tier: 2, name: "Llama 3 8B" },
  { id: "mistralai/mistral-7b-instruct", tier: 2, name: "Mistral 7B" },
  { id: "mistralai/mistral-7b-instruct:free", tier: 2, name: "Mistral 7B (Free)" },
  { id: "qwen/qwen-2-7b-instruct", tier: 2, name: "Qwen 2 7B" },
  { id: "google/gemma-7b-it", tier: 2, name: "Gemma 7B" },
  { id: "openchat/openchat-7b", tier: 2, name: "OpenChat 7B" },
  { id: "teknium/openhermes-2.5-mistral-7b", tier: 2, name: "OpenHermes 2.5 Mistral 7B" },
  { id: "nousresearch/nous-hermes-2-mistral-7b", tier: 2, name: "Nous Hermes 2 Mistral 7B" },
  
  // Tier 3: Lightweight / Fast
  { id: "google/gemma-2b-it", tier: 3, name: "Gemma 2B" },
  { id: "qwen/qwen-1.5-7b-chat", tier: 3, name: "Qwen 1.5 7B Chat" },
  { id: "microsoft/phi-3-mini-128k-instruct", tier: 3, name: "Phi-3 Mini" },
  { id: "undi95/toppy-m-7b", tier: 3, name: "Toppy M 7B" },
  { id: "intel/neural-chat-7b", tier: 3, name: "Neural Chat 7B" },
  { id: "huggingfaceh4/zephyr-7b-beta", tier: 3, name: "Zephyr 7B Beta" },
  { id: "gryphe/mythomist-7b", tier: 3, name: "Mythomist 7B" },
];

export const FALLBACK_CHAIN = [
  ...VERIFIED_FREE_MODELS.filter(m => m.tier === 1),
  ...VERIFIED_FREE_MODELS.filter(m => m.tier === 2),
  ...VERIFIED_FREE_MODELS.filter(m => m.tier === 3),
];

// In-memory cache for failed models (persists only while Edge Function instance is warm)
// Key: Model ID, Value: Timestamp (ms) until it should be retried
const FAILED_MODELS = new Map<string, number>();
const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
const COOLDOWN_404_MS = 24 * 60 * 60 * 1000; // 24 hours
const COOLDOWN_429_MS = 60 * 1000; // 60 seconds
const COOLDOWN_5XX_MS = 2 * 60 * 1000; // 2 minutes

const VALIDATION_TTL_MS = 5 * 60 * 1000; // 5 minutes
let validatedCache: { models: Model[]; expiresAt: number } | null = null;

export function markModelAsFailed(modelId: string, status?: number) {
  let cooldownMs = DEFAULT_COOLDOWN_MS;
  if (status === 404) cooldownMs = COOLDOWN_404_MS;
  else if (status === 429) cooldownMs = COOLDOWN_429_MS;
  else if (typeof status === "number" && status >= 500) cooldownMs = COOLDOWN_5XX_MS;

  const retryAt = Date.now() + cooldownMs;
  FAILED_MODELS.set(modelId, retryAt);
  console.warn(`[ModelRegistry] Marked model as failed: ${modelId} (Cooldown: ${cooldownMs}ms)`);
}

function isModelInCooldown(modelId: string): boolean {
  const retryAt = FAILED_MODELS.get(modelId);
  if (!retryAt) return false;

  if (Date.now() >= retryAt) {
    FAILED_MODELS.delete(modelId);
    return false;
  }
  return true;
}

/**
 * Smart Routing Logic:
 * 1. Tier 1 Round-Robin
 * 2. Fallback to next model in Tier 1
 * 3. Fallback to Tier 2 -> 3
 * 4. Exclude failed/cooldown models and explicitly excluded IDs (retry chain)
 */
export function getNextAvailableModel(exclude: string[] = []): string | null {
  // 1. Filter out permanently failed (cooldown) and temporarily excluded (current request retries) models
  const candidates = FALLBACK_CHAIN.filter(m => {
    if (exclude.includes(m.id)) return false;
    if (isModelInCooldown(m.id)) return false;
    return true;
  });

  if (candidates.length === 0) {
    return null;
  }

  // 2. Identify the highest available tier among candidates
  const topTier = candidates[0].tier;
  const topTierCandidates = candidates.filter(m => m.tier === topTier);

  // 3. Random Selection for the Top Tier
  const picked = topTierCandidates[Math.floor(Math.random() * topTierCandidates.length)];

  return picked.id;
}

export async function getNextAvailableModelAsync(supabaseAdmin: any, exclude: string[] = []): Promise<string> {
  let sourceModels = VERIFIED_FREE_MODELS;
  if (validatedCache && Date.now() < validatedCache.expiresAt) {
    sourceModels = validatedCache.models.length > 0 ? validatedCache.models : VERIFIED_FREE_MODELS;
  } else {
    try {
      const validated = await validateAvailableModels(supabaseAdmin);
      validatedCache = { models: validated, expiresAt: Date.now() + VALIDATION_TTL_MS };
      sourceModels = validated.length > 0 ? validated : VERIFIED_FREE_MODELS;
    } catch {
      sourceModels = VERIFIED_FREE_MODELS;
    }
  }

  const chain = [
    ...sourceModels.filter(m => m.tier === 1),
    ...sourceModels.filter(m => m.tier === 2),
    ...sourceModels.filter(m => m.tier === 3),
    ...sourceModels.filter(m => m.tier === 4),
  ];

  const candidates = chain.filter(m => {
    if (exclude.includes(m.id)) return false;
    if (isModelInCooldown(m.id)) return false;
    return true;
  });

  if (candidates.length === 0) {
    console.warn("[ModelRegistry] All models failed or excluded. Resetting exclusions as last resort.");
    return VERIFIED_FREE_MODELS[0].id;
  }

  const topTier = candidates[0].tier;
  const topTierCandidates = candidates.filter(m => m.tier === topTier);
  const picked = topTierCandidates[Math.floor(Math.random() * topTierCandidates.length)];
  return picked.id;
}

export function getVerifiedModelIds() {
    return VERIFIED_FREE_MODELS.map(m => m.id);
}

export function getActiveModels(): Model[] {
    return VERIFIED_FREE_MODELS.filter(m => !isModelInCooldown(m.id));
}

// --- Validation Logic ---

/**
 * Validates availability of models against OpenRouter API.
 * This is expensive, so it should be called sparingly (e.g. cron job or admin trigger).
 */
export async function validateAvailableModels(supabaseAdmin: any): Promise<Model[]> {
    const apiKey = await getApiKey(supabaseAdmin, "openrouter");
    if (!apiKey) {
        console.error("[ModelRegistry] No OpenRouter API Key found for validation.");
        return VERIFIED_FREE_MODELS;
    }

    try {
        const res = await fetch("https://openrouter.ai/api/v1/models", {
            headers: { "Authorization": `Bearer ${apiKey}` }
        });
        
        if (!res.ok) throw new Error(`Failed to fetch models: ${res.status}`);
        
        const data = await res.json();
        const availableIds = new Set(
          (data.data || [])
            .filter((m: any) => {
              const endpoints = m?.endpoints;
              if (!endpoints) return true;
              return Array.isArray(endpoints) && endpoints.length > 0;
            })
            .map((m: any) => m.id)
        );
        
        const validated = VERIFIED_FREE_MODELS.filter(m => availableIds.has(m.id));
        console.log(`[ModelRegistry] Validation complete. ${validated.length}/${VERIFIED_FREE_MODELS.length} models available.`);
        
        return validated;
    } catch (e) {
        console.error("[ModelRegistry] Validation failed:", e);
        return VERIFIED_FREE_MODELS; // Fail open
    }
}
