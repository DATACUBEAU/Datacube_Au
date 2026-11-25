package au.datacube.app.monetization

import org.junit.Assert.*
import org.junit.Test

class OfflineRewardLedgerTest {
    @Test fun exhaustedBalanceCannotBeReplayed() {
        val b = LeaseBalance(1,"lease",10,1000)
        val spent = requireNotNull(b.consume(10,100))
        assertEquals(0,spent.remaining)
        assertNull(spent.consume(1,100))
        assertNull(spent.consume(-1,100))
        assertNull(b.consume(1,1000))
        val lease = VerifiedOfflineLease("lease","account","device",RewardFeature.IMAGE,10,1,1,1000)
        assertNull(spent.replace(lease))
        assertEquals(10,spent.replace(lease.copy(sequence=2))?.remaining)
    }
}
