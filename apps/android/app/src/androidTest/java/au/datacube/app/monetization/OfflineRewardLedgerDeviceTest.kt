package au.datacube.app.monetization

import android.content.Context
import android.util.Base64
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.security.KeyPairGenerator
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.util.UUID
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class OfflineRewardLedgerDeviceTest {
    @Test fun signedAllowancePersistsAcrossInstancesAndRejectsReplay() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val account = UUID.randomUUID().toString()
        val device = UUID.randomUUID().toString()
        val keys = KeyPairGenerator.getInstance("EC").apply {
            initialize(ECGenParameterSpec("secp256r1"))
        }.generateKeyPair()
        val payload = listOf("AU-REWARD-V1",UUID.randomUUID().toString(),account,device,"image","10","1","1000","2000").joinToString("\n")
        val signature = Signature.getInstance("SHA256withECDSA").run {
            initSign(keys.private); update(payload.toByteArray(Charsets.UTF_8))
            Base64.encodeToString(sign(),Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
        }
        try {
            val lease = requireNotNull(OfflineLeaseVerifier.verify(payload,signature,keys.public,account,device,1500))
            assertNull(OfflineLeaseVerifier.verify(payload.replace("image","voice"),signature,keys.public,account,device,1500))
            assertNull(OfflineLeaseVerifier.verify(payload,signature,keys.public,account,"different_device_123",1500))
            assertNull(OfflineLeaseVerifier.verify(payload,signature,keys.public,account,device,2000))
            val ledger = OfflineRewardLedger(context,account,device)
            assertTrue(ledger.install(lease))
            assertTrue(ledger.consume(RewardFeature.IMAGE,9,1500))
            val reopened = OfflineRewardLedger(context,account,device)
            assertEquals(1,reopened.remaining(RewardFeature.IMAGE,1500))
            assertFalse(reopened.install(lease))
            assertFalse(reopened.consume(RewardFeature.IMAGE,2,1500))
            assertTrue(reopened.consume(RewardFeature.IMAGE,1,1500))
            assertEquals(0,reopened.remaining(RewardFeature.IMAGE,1500))
        } finally {
            context.getSharedPreferences("au_offline_rewards_v1",Context.MODE_PRIVATE)
                .edit().remove("$account:$device:image").commit()
        }
    }
}
