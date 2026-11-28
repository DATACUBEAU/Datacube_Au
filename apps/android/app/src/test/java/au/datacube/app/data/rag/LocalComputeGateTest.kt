package au.datacube.app.data.rag

import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.withLock
import org.junit.Assert.assertEquals
import org.junit.Test

class LocalComputeGateTest {
    @Test fun backgroundCannotEnterBetweenInteractiveRetrievalAndGeneration() = runBlocking {
        val retrievalDone = CompletableDeferred<Unit>()
        val continueRequest = CompletableDeferred<Unit>()
        val order = mutableListOf<String>()
        val request = launch(start = CoroutineStart.UNDISPATCHED) {
            LocalComputeGate.interactiveRequest {
                LocalComputeGate.admit(interactive = true) { order += "retrieval" }
                retrievalDone.complete(Unit)
                continueRequest.await()
                LocalComputeGate.admit(interactive = true) { order += "generation" }
            }
        }
        retrievalDone.await()
        val background = launch(start = CoroutineStart.UNDISPATCHED) {
            LocalComputeGate.admit(interactive = false) { order += "background" }
        }
        assertEquals(listOf("retrieval"), order)
        continueRequest.complete(Unit)
        request.join()
        background.join()
        assertEquals(listOf("retrieval", "generation", "background"), order)
    }

    @Test fun cancelledInteractiveReservationDoesNotBlockBackground() = runBlocking {
        val request = launch(start = CoroutineStart.UNDISPATCHED) {
            LocalComputeGate.interactiveRequest { kotlinx.coroutines.awaitCancellation() }
        }
        request.cancel()
        request.join()
        val result = kotlinx.coroutines.withTimeout(1000) {
            LocalComputeGate.admit(interactive = false) { "available" }
        }
        assertEquals("available", result)
    }

    @Test fun queuedInteractiveRequestPrecedesWaitingBackgroundWork() = runBlocking {
        val entered = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val order = mutableListOf<String>()
        val existing = launch(start = CoroutineStart.UNDISPATCHED) {
            LocalComputeGate.admit(interactive = false) { entered.complete(Unit); release.await() }
        }
        entered.await()
        val background = launch(start = CoroutineStart.UNDISPATCHED) {
            LocalComputeGate.admit(interactive = false) { order += "background" }
        }
        val foreground = launch(start = CoroutineStart.UNDISPATCHED) {
            LocalComputeGate.admit(interactive = true) { order += "foreground" }
        }
        release.complete(Unit)
        existing.join(); background.join(); foreground.join()
        assertEquals(listOf("foreground", "background"), order)
    }

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
