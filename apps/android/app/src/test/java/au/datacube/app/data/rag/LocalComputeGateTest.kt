package au.datacube.app.data.rag

import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.withLock
import org.junit.Assert.assertEquals
import org.junit.Test

class LocalComputeGateTest {
    @Test fun heavyweightJobsNeverOverlap() = runBlocking {
        val active = AtomicInteger(0)
        val peak = AtomicInteger(0)
        coroutineScope {
            repeat(12) {
                launch(Dispatchers.Default) {
                    LocalComputeGate.mutex.withLock {
                        val count = active.incrementAndGet()
                        peak.updateAndGet { maxOf(it, count) }
                        try { delay(5) } finally { active.decrementAndGet() }
                    }
                }
            }
        }
        assertEquals(1, peak.get())
        assertEquals(0, active.get())
    }
}
