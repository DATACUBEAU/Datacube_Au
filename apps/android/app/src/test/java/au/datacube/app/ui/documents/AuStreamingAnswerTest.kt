package au.datacube.app.ui.documents

import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class AuStreamingAnswerTest {
    @Test fun hiddenReasoningDoesNotPublishAndFinalTailAlwaysFlushes() = runBlocking {
        var now = 0L
        val shown = mutableListOf<String>()
        val stream = AuStreamingAnswer(0, { now }) { shown += it }
        stream.append("<think>hidden")
        assertTrue(shown.isEmpty())
        now = 120L
        stream.append("</think>Visible")
        assertEquals(listOf("Visible"), shown)
        now = 130L
        stream.append(" answer.")
        assertEquals(listOf("Visible"), shown)
        assertEquals("Visible answer.", stream.finish())
        assertEquals(listOf("Visible", "Visible answer."), shown)
    }

    @Test fun incompleteDiagramNeverExposesCommands() = runBlocking {
        var now = 0L
        val shown = mutableListOf<String>()
        val stream = AuStreamingAnswer(0, { now }) { shown += it }
        stream.append("Explanation.\n[SKETCH] Cell\nLINE | 1 | 2")
        assertEquals(listOf("Explanation."), shown)
        now = 200L
        stream.append(" | 3 | 4\n[/SKETCH]")
        assertTrue(stream.finish().contains("[/SKETCH]"))
    }

    @Test fun outputLimitFailsExplicitlyInsteadOfSilentlyTruncating() = runBlocking {
        val stream = AuStreamingAnswer(0, { 0L }) {}
        try {
            stream.append("x".repeat(12001))
            fail("Expected explicit limit")
        } catch (_: IllegalStateException) {}
        assertTrue(stream.partial().isEmpty())
    }
}
