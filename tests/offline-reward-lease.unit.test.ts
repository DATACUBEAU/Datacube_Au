import assert from 'node:assert/strict';
import { generateKeyPairSync,verify } from 'node:crypto';
import { issueOfflineLease,leasePayload,signOfflineLease,type OfflineRewardLease } from '../src/lib/server/rewards/offline-lease';

async function main() {
  const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  const pem=privateKey.export({type:'pkcs8',format:'pem'}).toString();
  const lease:OfflineRewardLease={id:'lease_fixture_0001',accountId:'account_fixture_0001',deviceId:'device_fixture_0001',feature:'image',units:10,sequence:1,issuedAt:1000,expiresAt:2000};
  const signed=signOfflineLease(lease,pem);
  assert.equal(signed.payload,leasePayload(lease));
  assert.equal(verify('sha256',Buffer.from(signed.payload),publicKey,Buffer.from(signed.signature,'base64url')),true);
  assert.equal(verify('sha256',Buffer.from(signed.payload.replace('image','voice')),publicKey,Buffer.from(signed.signature,'base64url')),false);
  assert.throws(()=>leasePayload({...lease,units:11}));
  assert.throws(()=>leasePayload({...lease,sequence:0}));
  assert.throws(()=>leasePayload({...lease,deviceId:'invalid\nfield'}));
  await assert.rejects(issueOfflineLease({allocate:async()=>({...lease,accountId:'another_account_0001'})},lease.accountId,lease.deviceId,'image','operation_fixture_001',pem),/scope_mismatch/);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
