
export const VERIFIED_FREE_MODELS = [
  // Tier 1: Best Quality
  { id: "meta-llama/llama-3.3-70b-instruct:free", tier: 1, name: "Llama 3.3 70B (Free)" },
  { id: "meta-llama/llama-3.1-405b-instruct:free", tier: 1, name: "Llama 3.1 405B (Free)" },
  { id: "deepseek/deepseek-r1:free", tier: 1, name: "DeepSeek R1 (Free)" },
  { id: "qwen/qwen-2.5-72b-instruct:free", tier: 1, name: "Qwen 2.5 72B (Free)" },
  
  // Tier 2: Balanced Chat
  { id: "mistralai/mistral-small-24b-instruct-2501:free", tier: 2, name: "Mistral Small 3 (Free)" },
  { id: "mistralai/mistral-7b-instruct:free", tier: 2, name: "Mistral 7B (Free)" },
  { id: "meta-llama/llama-3-8b-instruct:free", tier: 2, name: "Llama 3 8B (Free)" },

  // Tier 3: Lightweight & Fast
  { id: "meta-llama/llama-3.2-3b-instruct:free", tier: 3, name: "Llama 3.2 3B (Free)" },
  { id: "google/gemma-2-9b-it:free", tier: 3, name: "Gemma 2 9B (Free)" },

  // Tier 4: Code / Specialty
  { id: "mistralai/codestral-2501:free", tier: 4, name: "Codestral (Free)" },
  { id: "qwen/qwen-2.5-coder-32b-instruct:free", tier: 4, name: "Qwen 2.5 Coder (Free)" },
];

export const FALLBACK_CHAIN = [
  ...VERIFIED_FREE_MODELS.filter(m => m.tier === 1),
  ...VERIFIED_FREE_MODELS.filter(m => m.tier === 2),
  ...VERIFIED_FREE_MODELS.filter(m => m.tier === 3),
  ...VERIFIED_FREE_MODELS.filter(m => m.tier === 4),
];

// Simple in-memory cache for failed models (note: Edge functions are ephemeral, so this is per-invocation or short-lived container)
const FAILED_MODELS = new Set<string>();

export function markModelAsFailed(modelId: string) {
  FAILED_MODELS.add(modelId);
  console.warn(`[ModelRegistry] Marked model as failed: ${modelId}`);
}

export function getNextAvailableModel(exclude: string[] = []): string {
  const candidates = FALLBACK_CHAIN.filter(m => !FAILED_MODELS.has(m.id) && !exclude.includes(m.id));
  if (candidates.length === 0) {
    // If all failed, reset failed list and try Tier 1 again (desperation)
    return VERIFIED_FREE_MODELS[0].id;
  }
  
  // Pick from the highest available tier
  const topTier = candidates[0].tier;
  const topTierCandidates = candidates.filter(m => m.tier === topTier);
  // Random pick for load balancing
  const picked = topTierCandidates[Math.floor(Math.random() * topTierCandidates.length)];
  
  return picked.id;
}

export function getVerifiedModelIds() {
    return VERIFIED_FREE_MODELS.map(m => m.id);
}
