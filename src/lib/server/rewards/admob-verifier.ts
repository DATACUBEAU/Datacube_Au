import { createPublicKey, verify } from 'node:crypto';
import type { RewardVerifier, VerifiedReceipt } from './reward-engine';

/** Verify the original signed callback before trusting any fields.
 * The injected key resolver must use Google's official key service and cache
 * its keys for at most 24 hours. Never accept keys supplied by a callback.
 * This adapter is not registered with a live endpoint yet.
 */
export function createAdMobVerifier(
  resolveKey: (keyId: string) => Promise<string | null>,
  allowedAdUnits: ReadonlySet<string>,
): RewardVerifier {
  return {
    async verify(rawCallback: string): Promise<VerifiedReceipt | null> {
      if (rawCallback.length > 8192 || !allowedAdUnits.size) return null;
      // Accept a raw query string (without ?). Never reserialize or reorder it.
      const match = /^(.*)&signature=([A-Za-z0-9_-]+={0,2})&key_id=([0-9]{1,20})$/.exec(rawCallback);
      if (!match || !match[1]) return null;
      const [, signed, signature, keyId] = match;
      const params = new URLSearchParams(signed);
      const seen = new Set<string>();
      for (const name of params.keys()) {
        if (seen.has(name) || name === 'signature' || name === 'key_id') return null;
        seen.add(name);
      }
      const unit = params.get('ad_unit');
      const intentId = params.get('custom_data');
      const transactionId = params.get('transaction_id');
      const timestamp = params.get('timestamp');
      if (!unit || !allowedAdUnits.has(unit) ||
          !intentId || !/^[A-Za-z0-9_-]{16,128}$/.test(intentId) ||
          !transactionId || !/^[A-Fa-f0-9]{1,128}$/.test(transactionId) ||
          !timestamp || !/^[0-9]{10,17}$/.test(timestamp)) return null;
      const pem = await resolveKey(keyId);
      if (!pem) return null;
      try {
        const key = createPublicKey(pem);
        if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') return null;
        if (!verify('sha256', Buffer.from(signed, 'utf8'), key, Buffer.from(signature, 'base64url'))) return null;
      } catch {
        return null;
      }
      return { provider: 'admob', intentId, transactionId };
    },
  };
}
