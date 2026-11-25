import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createAdMobVerifier } from '../src/lib/server/rewards/admob-verifier';
import { acceptReward, type RewardStore, type RewardGrant } from '../src/lib/server/rewards/reward-engine';

async function main() {
  const {privateKey, publicKey} = generateKeyPairSync('ec', {namedCurve:'prime256v1'});
  const pem = publicKey.export({type:'spki',format:'pem'}).toString();
  const now = 1795615000000;
  const intentId = 'reward_intent_fixture_001';
  const payload = 'ad_network=123&ad_unit=test-unit&custom_data=' + intentId +
    '&reward_amount=1&reward_item=image&timestamp=' + now + '&transaction_id=abcdef123';
  const signed = (query: string) => query + '&signature=' +
    sign('sha256', Buffer.from(query), privateKey).toString('base64url') + '&key_id=123';
  const verifier = createAdMobVerifier(async id => id === '123' ? pem : null, new Set(['test-unit']));
  const callback = signed(payload);
  assert.deepEqual(await verifier.verify(callback), {provider:'admob', intentId, transactionId:'abcdef123'});
  assert.equal(await verifier.verify(callback.replace('reward_amount=1','reward_amount=9')), null);
  assert.equal(await verifier.verify(callback.replace('key_id=123','key_id=999')), null);
  assert.equal(await verifier.verify(signed(payload.replace('test-unit','wrong-unit'))), null);
  assert.equal(await verifier.verify(signed(payload + '&custom_data=duplicate')), null);
  assert.equal(await verifier.verify(callback + '&extra=1'), null);

  const grants: RewardGrant[] = [];
  const store: RewardStore = {
    async findIntent(id) {
      return id === intentId ? {id, accountId:'test-account', provider:'admob', feature:'image', expiresAt:now+60000} : null;
    },
    async grantOnce(grant) {
      if (grants.some(g => g.intentId === grant.intentId || g.transactionId === grant.transactionId)) return 'duplicate';
      grants.push(grant);
      return 'granted';
    },
  };
  assert.equal(await acceptReward('admob',callback,{},store,now),'rejected');
  assert.equal(await acceptReward('admob',callback,{admob:verifier},store,now),'granted');
  assert.equal(await acceptReward('admob',callback,{admob:verifier},store,now),'duplicate');
  assert.equal(grants.length,1);
  assert.equal(grants[0].units,10);
  assert.equal(grants[0].accountId,'test-account');
  assert.equal(await acceptReward('admob',callback,{admob:verifier},store,now+60001),'rejected');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
