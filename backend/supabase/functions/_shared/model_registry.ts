
import { getApiKey } from "./getApiKey.ts";

export interface Model {
  id: string;
  tier: 1 | 2 | 3 | 4;
  name: string;
}

export const VERIFIED_FREE_MODELS: Model[] = [
  // Tier 1: Best Quality (70B+ & large reasoning)
  { id: "meta-llama/llama-3.3-70b-instruct:free", tier: 1, name: "Llama 3.3 70B (Free)" },
  { id: "meta-llama/llama-3.1-405b-instruct:free", tier: 1, name: "Llama 3.1 405B (Free)" },
  { id: "deepseek/deepseek-r1:free", tier: 1, name: "DeepSeek R1 (Free)" }, // Alias for r1-0528 usually, using standard free ID
  { id: "deepseek/deepseek-r1-0528:free", tier: 1, name: "DeepSeek R1 0528 (Free)" }, // Explicitly requested
  { id: "qwen/qwen-3-235b-a22b:free", tier: 1, name: "Qwen 3 235B (Free)" }, // Trusted from user input
  { id: "qwen/qwen-2.5-72b-instruct:free", tier: 1, name: "Qwen 2.5 72B (Free)" }, // Keeping as strong backup

  // Tier 2: Balanced Chat
  { id: "mistralai/mistral-small-3.1-24b:free", tier: 2, name: "Mistral Small 3.1 (Free)" }, // Updated from user request
  { id: "mistralai/mistral-7b-instruct:free", tier: 2, name: "Mistral 7B (Free)" },
  { id: "meta-llama/llama-3-8b-instruct:free", tier: 2, name: "Llama 3 8B (Free)" },

  // Tier 3: Lightweight & Fast
  { id: "meta-llama/llama-3.2-3b-instruct:free", tier: 3, name: "Llama 3.2 3B (Free)" },
  { id: "google/gemma-3-4b-instruct:free", tier: 3, name: "Gemma 3 4B (Free)" },
  { id: "mistralai/devstral-2512:free", tier: 3, name: "Devstral 2512 (Free)" },

  // Tier 4: Code / Specialty
  { id: "qwen/qwen-3-coder:free", tier: 4, name: "Qwen 3 Coder (Free)" },
];

export const FALLBACK_CHAIN = [
  ...VERIFIED_FREE_MODELS.filter(m => m.tier === 1),
  ...VERIFIED_FREE_MODELS.filter(m => m.tier === 2),
  ...VERIFIED_FREE_MODELS.filter(m => m.tier === 3),
  ...VERIFIED_FREE_MODELS.filter(m => m.tier === 4),
];

// In-memory cache for failed models (persists only while Edge Function instance is warm)
// Key: Model ID, Value: Timestamp when it failed
const FAILED_MODELS = new Map<string, number>();
const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

export function markModelAsFailed(modelId: string) {
  FAILED_MODELS.set(modelId, Date.now());
  console.warn(`[ModelRegistry] Marked model as failed: ${modelId} (Cooldown: ${COOLDOWN_MS}ms)`);
}

function isModelInCooldown(modelId: string): boolean {
  const failedAt = FAILED_MODELS.get(modelId);
  if (!failedAt) return false;
  
  const elapsed = Date.now() - failedAt;
  if (elapsed > COOLDOWN_MS) {
    FAILED_MODELS.delete(modelId); // Cooldown expired
    return false;
  }
  return true;
}

/**
 * Smart Routing Logic:
 * 1. Tier 1 Round-Robin
 * 2. Fallback to next model in Tier 1
 * 3. Fallback to Tier 2 -> 3 -> 4
 * 4. Exclude failed/cooldown models and explicitly excluded IDs (retry chain)
 */
export function getNextAvailableModel(exclude: string[] = []): string {
  // 1. Filter out permanently failed (cooldown) and temporarily excluded (current request retries) models
  const candidates = FALLBACK_CHAIN.filter(m => {
    if (exclude.includes(m.id)) return false;
    if (isModelInCooldown(m.id)) return false;
    return true;
  });

  if (candidates.length === 0) {
    console.warn("[ModelRegistry] All models failed or excluded. Resetting exclusions as last resort.");
    // If absolutely everything is down, try the first Tier 1 model again regardless of status
    return VERIFIED_FREE_MODELS[0].id;
  }

  // 2. Identify the highest available tier among candidates
  const topTier = candidates[0].tier;
  const topTierCandidates = candidates.filter(m => m.tier === topTier);

  // 3. Round-Robin / Random Selection for the Top Tier
  // Since we don't have shared state for true round-robin, random is a good approximation for load balancing.
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
        const availableIds = new Set((data.data || []).map((m: any) => m.id));
        
        const validated = VERIFIED_FREE_MODELS.filter(m => availableIds.has(m.id));
        console.log(`[ModelRegistry] Validation complete. ${validated.length}/${VERIFIED_FREE_MODELS.length} models available.`);
        
        return validated;
    } catch (e) {
        console.error("[ModelRegistry] Validation failed:", e);
        return VERIFIED_FREE_MODELS; // Fail open
    }
}
