package au.datacube.app.data.rag

import org.junit.Assert.assertEquals
import org.junit.Test

class AuDeviceEffortTest {
    private val gib = 1024L * 1024L * 1024L

    @Test fun lowMemoryUsesFastEvenWhenMaximumRequested() {
        assertEquals(AuEffort.FAST, AuEffort.MAXIMUM.forMemory(4 * gib, 2 * gib, false))
        assertEquals(AuEffort.FAST, AuEffort.MAXIMUM.forMemory(12 * gib, gib, false))
        assertEquals(AuEffort.FAST, AuEffort.MAXIMUM.forMemory(12 * gib, 8 * gib, true))
    }

    @Test fun midRangeIsBoundedAndHighMemoryPreservesRequestedEffort() {
        assertEquals(AuEffort.BALANCED, AuEffort.MAXIMUM.forMemory(8 * gib, 4 * gib, false))
        assertEquals(AuEffort.MAXIMUM, AuEffort.MAXIMUM.forMemory(12 * gib, 6 * gib, false))
        assertEquals(AuEffort.FAST, AuEffort.FAST.forMemory(12 * gib, 6 * gib, false))
    }
}
