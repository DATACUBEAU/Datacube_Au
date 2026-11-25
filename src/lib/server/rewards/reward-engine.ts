/** Server-side reward service foundation. No endpoint or provider is enabled by this module.
 * Provider adapters must verify signed callbacks before returning a receipt.
 * The database adapter must atomically enforce both unique intent and provider transaction IDs.
 */
export const REWARD_UNITS = {
  podcast: 1800,
  image: 10,
  voice: 10,
} as const;
export type RewardFeature = keyof typeof REWARD_UNITS;
export type RewardProvider = 'admob' | 'startio';
export type VerifiedReceipt = {
  provider: RewardProvider;
  transactionId: string;
  intentId: string;
};
export type RewardIntent = {
  id: string;
  accountId: string;
  feature: RewardFeature;
  provider: RewardProvider;
  expiresAt: number;
};
export type RewardGrant = VerifiedReceipt & {
  accountId: string;
  feature: RewardFeature;
  units: number;
};
export interface RewardStore {
  findIntent(id: string): Promise<RewardIntent | null>;
  /** Recheck pending intent, ownership, expiry and provider under transaction lock.
   * Unique provider + transaction ID and unique intent ID are required in persistent storage.
   * Duplicate callbacks must return duplicate without crediting the balance twice.
   */
  grantOnce(grant: RewardGrant, now: number): Promise<'granted' | 'duplicate' | 'rejected'>;
}
export interface RewardVerifier {
  verify(rawCallback: string): Promise<VerifiedReceipt | null>;
}
export async function acceptReward(
  provider: RewardProvider,
  rawCallback: string,
  verifiers: Partial<Record<RewardProvider, RewardVerifier>>,
  store: RewardStore,
  now = Date.now(),
): Promise<'granted' | 'duplicate' | 'rejected'> {
  const verifier = verifiers[provider];
  if (!verifier || !rawCallback || rawCallback.length > 8192) return 'rejected';
  const receipt = await verifier.verify(rawCallback);
  if (!receipt || receipt.provider !== provider ||
      !receipt.transactionId || receipt.transactionId.length > 256 ||
      !receipt.intentId || receipt.intentId.length > 128) return 'rejected';
  const intent = await store.findIntent(receipt.intentId);
  if (!intent || intent.provider !== provider || intent.id !== receipt.intentId ||
      intent.expiresAt <= now || !intent.accountId ||
      !Object.prototype.hasOwnProperty.call(REWARD_UNITS, intent.feature)) return 'rejected';
  return store.grantOnce({
    ...receipt, accountId: intent.accountId, feature: intent.feature,
    units: REWARD_UNITS[intent.feature],
  }, now);
}

/** Consume only persisted verified grants, never client impression claims.
 * Caller must authenticate the owner before querying records or exposing this result.
 */
export function summarizeRewardGrants(grants: readonly RewardGrant[]) {
  const unique = new Map<string, RewardGrant>();
  for (const grant of grants) {
    const key = JSON.stringify([grant.provider, grant.transactionId]);
    if (!unique.has(key)) unique.set(key, grant);
  }
  const accounts = new Set<string>();
  const byFeature = { podcast: 0, image: 0, voice: 0 };
  const byProvider = { admob: 0, startio: 0 };
  for (const grant of unique.values()) {
    accounts.add(grant.accountId);
    byFeature[grant.feature]++;
    byProvider[grant.provider]++;
  }
  return { verifiedCompletions: unique.size, uniqueAccounts: accounts.size, byFeature, byProvider };
}
