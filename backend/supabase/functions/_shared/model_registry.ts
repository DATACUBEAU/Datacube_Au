
import { getApiKey } from "./getApiKey.ts";

export interface Model {
  id: string;
  tier: 1 | 2 | 3 | 4;
  name: string;
}

export const VERIFIED_FREE_MODELS: Model[] = [
  // Tier 1: Top Tier / Reasoning / Large
  { id: "meta-llama/llama-3.3-70b-instruct:free", tier: 1, name: "Llama 3.3 70B (Free)" },
  { id: "deepseek/deepseek-r1:free", tier: 1, name: "DeepSeek R1 (Free)" },
  { id: "qwen/qwen-2.5-72b-instruct:free", tier: 1, name: "Qwen 2.5 72B (Free)" },
  { id: "google/gemini-2.0-flash-exp:free", tier: 1, name: "Gemini 2.0 Flash Exp (Free)" },
  { id: "nvidia/llama-3.1-nemotron-70b-instruct:free", tier: 1, name: "Nemotron 70B (Free)" },
  
  // Tier 2: Mid Tier / Balanced
  { id: "meta-llama/llama-3.1-8b-instruct:free", tier: 2, name: "Llama 3.1 8B (Free)" },
  { id: "meta-llama/llama-3-8b-instruct:free", tier: 2, name: "Llama 3 8B (Free)" },
  { id: "google/gemma-2-9b-it:free", tier: 2, name: "Gemma 2 9B (Free)" },
  { id: "qwen/qwen-2-7b-instruct:free", tier: 2, name: "Qwen 2 7B (Free)" },
  { id: "mistralai/mistral-7b-instruct:free", tier: 2, name: "Mistral 7B (Free)" },
  { id: "mistralai/mistral-small-24b-instruct-2501:free", tier: 2, name: "Mistral Small (Free)" },
  { id: "cognitivecomputations/dolphin-mixtral-8x7b:free", tier: 2, name: "Dolphin Mixtral 8x7B (Free)" },
  { id: "mistralai/pixtral-12b:free", tier: 2, name: "Pixtral 12B (Free)" },
  
  // Tier 3: Lightweight / Fast
  { id: "meta-llama/llama-3.2-3b-instruct:free", tier: 3, name: "Llama 3.2 3B (Free)" },
  { id: "google/gemma-2-2b-it:free", tier: 3, name: "Gemma 2 2B (Free)" },
  { id: "microsoft/phi-3-mini-128k-instruct:free", tier: 3, name: "Phi-3 Mini (Free)" },
  { id: "google/gemini-2.0-flash-lite-preview-02-05:free", tier: 3, name: "Gemini 2.0 Flash Lite (Free)" },
];

export const FALLBACK_CHAIN = [
  ...VERIFIED_FREE_MODELS.filter(m => m.tier === 1),
  ...VERIFIED_FREE_MODELS.filter(m => m.tier === 2),
  ...VERIFIED_FREE_MODELS.filter(m => m.tier === 3),
];

// In-memory health scoring and cooldowns - Keyed by scope (e.g. "chat", "knowledge")
const FAILED_MODELS = new Map<string, Map<string, number>>(); // scope -> modelId -> retryAt
const MODEL_SCORES = new Map<string, Map<string, number>>(); // scope -> modelId -> score

const FEATURE_PREFERENCES: Record<string, string[]> = {
  "knowledge": [
    "meta-llama/llama-3.3-70b-instruct:free",
    "google/gemini-2.0-flash-exp:free",
    "deepseek/deepseek-r1:free",
    "mistralai/mistral-small-24b-instruct-2501:free"
  ],
  "chat": [
    "google/gemini-2.0-flash-exp:free",
    "meta-llama/llama-3.3-70b-instruct:free",
    "google/gemini-2.0-flash-lite-preview-02-05:free"
  ],
  "prediction": [
    "qwen/qwen-2.5-72b-instruct:free",
    "nvidia/llama-3.1-nemotron-70b-instruct:free"
  ],
  "exam": [
    "meta-llama/llama-3.3-70b-instruct:free",
    "deepseek/deepseek-r1:free"
  ]
};

const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
const COOLDOWN_404_MS = 30 * 60 * 1000;    // 30 minutes (dynamic check later)
const COOLDOWN_429_MS = 60 * 1000;         // 60 seconds
const COOLDOWN_5XX_MS = 2 * 60 * 1000;     // 2 minutes

const SCORE_SUCCESS = 1;
const SCORE_PENALTY_429 = -2;
const SCORE_PENALTY_404 = -5;
const SCORE_PENALTY_DEFAULT = -1;
const SCORE_MIN_THRESHOLD = -10;

const VALIDATION_TTL_MS = 5 * 60 * 1000; // 5 minutes
let validatedCache: { models: Model[]; expiresAt: number } | null = null;

function getScopeMap(map: Map<string, Map<string, any>>, scope: string): Map<string, any> {
  if (!map.has(scope)) {
    map.set(scope, new Map());
  }
  return map.get(scope)!;
}

export function reportModelHealth(modelId: string, success: boolean, status?: number, scope = "chat") {
  const scopeScores = getScopeMap(MODEL_SCORES, scope);
  const scopeFailures = getScopeMap(FAILED_MODELS, scope);
  
  const currentScore = scopeScores.get(modelId) ?? 0;
  
  if (success) {
    scopeScores.set(modelId, Math.min(currentScore + SCORE_SUCCESS, 10)); // Cap at +10
    scopeFailures.delete(modelId); // Clear cooldown on success
    return;
  }

  // Handle failure
  let penalty = SCORE_PENALTY_DEFAULT;
  let cooldownMs = DEFAULT_COOLDOWN_MS;

  if (status === 404) {
    penalty = SCORE_PENALTY_404;
    cooldownMs = COOLDOWN_404_MS;
  } else if (status === 429) {
    penalty = SCORE_PENALTY_429;
    cooldownMs = COOLDOWN_429_MS;
  } else if (typeof status === "number" && status >= 500) {
    cooldownMs = COOLDOWN_5XX_MS;
  }

  const newScore = Math.max(currentScore + penalty, SCORE_MIN_THRESHOLD);
  scopeScores.set(modelId, newScore);

  // If score is critically low, force a longer cooldown
  if (newScore <= -5) {
    cooldownMs = Math.max(cooldownMs, 15 * 60 * 1000); // at least 15 mins
  }

  const retryAt = Date.now() + cooldownMs;
  scopeFailures.set(modelId, retryAt);
  
  console.warn(
    `[ModelRegistry][${scope}] Model ${modelId} health updated: score=${newScore}, cooldown=${cooldownMs}ms (status=${status ?? "unknown"})`
  );
}

/**
 * Kept for backward compatibility, now wraps reportModelHealth
 */
export function markModelAsFailed(modelId: string, status?: number, scope = "chat") {
  reportModelHealth(modelId, false, status, scope);
}

function isModelInCooldown(modelId: string, scope = "chat"): boolean {
  const scopeFailures = getScopeMap(FAILED_MODELS, scope);
  const retryAt = scopeFailures.get(modelId);
  if (!retryAt) return false;

  if (Date.now() >= retryAt) {
    scopeFailures.delete(modelId);
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
export function getNextAvailableModel(exclude: string[] = [], scope = "chat"): string | null {
  // 1. Filter out permanently failed (cooldown) and temporarily excluded (current request retries) models
  const candidates = FALLBACK_CHAIN.filter(m => {
    if (exclude.includes(m.id)) return false;
    if (isModelInCooldown(m.id, scope)) return false;
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

export async function getNextAvailableModelAsync(supabaseAdmin: any, exclude: string[] = [], scope = "chat"): Promise<string> {
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
    if (isModelInCooldown(m.id, scope)) return false;
    return true;
  });

  if (candidates.length === 0) {
    console.warn(`[ModelRegistry][${scope}] All models failed or excluded. Resetting exclusions as last resort.`);
    return VERIFIED_FREE_MODELS[0].id;
  }

  // 4. Feature Bias (Soft Preference)
  // If we have preferred models for this scope, try to pick from them first if they are in candidates.
  const preferences = FEATURE_PREFERENCES[scope] || [];
  const preferredCandidates = candidates.filter(m => preferences.includes(m.id));
  
  // Use preferred candidates if any are available and healthy
  const selectionPool = preferredCandidates.length > 0 ? preferredCandidates : candidates;

  const topTier = selectionPool[0].tier;
  const topTierCandidates = selectionPool.filter(m => m.tier === topTier);
  
  const scopeScores = getScopeMap(MODEL_SCORES, scope);

  // 3. Score-aware selection: Sort by score descending
  // Models with higher success rates (higher scores) are tried first within the tier.
  topTierCandidates.sort((a, b) => {
    const scoreA = scopeScores.get(a.id) ?? 0;
    const scoreB = scopeScores.get(b.id) ?? 0;
    return scoreB - scoreA;
  });

  // Pick the best one (top of sorted list), or pick among equals randomly to load balance
  const bestScore = scopeScores.get(topTierCandidates[0].id) ?? 0;
  const equals = topTierCandidates.filter(m => (scopeScores.get(m.id) ?? 0) === bestScore);
  
  const picked = equals[Math.floor(Math.random() * equals.length)];
  return picked.id;
}

export function getVerifiedModelIds() {
    return VERIFIED_FREE_MODELS.map(m => m.id);
}

export function getActiveModels(scope = "chat"): Model[] {
    return VERIFIED_FREE_MODELS.filter(m => !isModelInCooldown(m.id, scope));
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
