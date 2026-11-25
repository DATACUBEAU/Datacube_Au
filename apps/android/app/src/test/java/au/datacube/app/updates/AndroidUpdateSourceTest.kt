package au.datacube.app.updates

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.fail
import org.junit.Test

class AndroidUpdateSourceTest {
    private val update = AndroidUpdateRelease(25, "1.0.25", "apk", 1024, "hash", "notes")

    @Test fun staleWebsiteDoesNotSuppressGitHubRecovery() = runBlocking {
        val calls = mutableListOf<String>()
        val result = resolveUpdateSources(listOf(
            suspend { calls += "official"; null },
            suspend { calls += "legacy"; null },
            suspend { calls += "github"; update }
        ))
        assertEquals(update, result)
        assertEquals(listOf("official", "legacy", "github"), calls)
    }

    @Test fun verifiedWebsiteUpdateDoesNotSpendGitHubQuota() = runBlocking {
        var fallbackCalled = false
        val result = resolveUpdateSources(listOf(
            suspend { update },
            suspend { fallbackCalled = true; null }
        ))
        assertEquals(update, result)
        assertEquals(false, fallbackCalled)
    }

    @Test fun websiteOutageCanRecoverAndReportNoUpdate() = runBlocking {
        assertNull(resolveUpdateSources(listOf(
            suspend { error("website unavailable") },
            suspend { null }
        )))
    }

    @Test fun recoveryFailureIsNotReportedAsUpToDate() = runBlocking {
        try {
            resolveUpdateSources(listOf(suspend { null }, suspend { error("metadata unavailable") }))
            fail("Expected metadata failure")
        } catch (expected: IllegalStateException) {
            assertEquals("metadata unavailable", expected.message)
        }
    }

    @Test fun cancellationNeverStartsAnotherSource() = runBlocking {
        var fallbackCalled = false
        try {
            resolveUpdateSources(listOf(
                suspend { throw CancellationException("cancelled") },
                suspend { fallbackCalled = true; update }
            ))
            fail("Expected cancellation")
        } catch (_: CancellationException) {
            assertEquals(false, fallbackCalled)
        }
    }
}
