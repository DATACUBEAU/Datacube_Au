package au.datacube.app.monetization

import org.junit.Assert.*
import org.junit.Test

class DistributionAdChannelTest {
    @Test fun channelsAreExplicitAndFailClosed() {
        assertEquals("startio", DistributionAdChannel.fromBuildChannel("website").provider)
        assertEquals("admob", DistributionAdChannel.fromBuildChannel("oppo").provider)
        assertNull(DistributionAdChannel.fromBuildChannel("development").provider)
        assertNull(DistributionAdChannel.fromBuildChannel("unknown").provider)
        assertTrue(DistributionAdChannel.WEBSITE.usesDirectUpdater)
        assertFalse(DistributionAdChannel.OPPO.usesDirectUpdater)
    }
}
