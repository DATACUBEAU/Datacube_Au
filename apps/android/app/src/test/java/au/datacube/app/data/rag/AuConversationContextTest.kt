package au.datacube.app.data.rag

import java.time.ZoneId
import java.time.ZonedDateTime
import org.junit.Assert.*
import org.junit.Test

class AuConversationContextTest {
    private val zone = ZoneId.of("Africa/Lagos")
    private val now = ZonedDateTime.of(2026, 11, 24, 12, 0, 0, 0, zone)
    private fun at(day: Int) = now.minusDays(day.toLong()).toInstant().toEpochMilli()

    @Test fun recallsOnlyActualYesterdayUserQuestions() {
        val entries = listOf(
            ConversationEntry("Explain respiration", at(1), true),
            ConversationEntry("What is ATP?", at(1), true),
            ConversationEntry("Today question", at(0), true),
            ConversationEntry("Earlier question", at(2), true),
            ConversationEntry("Invented old date", null, true),
            ConversationEntry("AU answer", at(1), false)
        )
        val result = AuConversationContext.yesterdayReply(entries, at(0), zone)
        assertTrue(result.contains("Explain respiration"))
        assertTrue(result.contains("What is ATP?"))
        assertFalse(result.contains("Today question"))
        assertFalse(result.contains("Earlier question"))
        assertFalse(result.contains("Invented old date"))
        assertFalse(result.contains("AU answer"))
    }

    @Test fun undatedHistoryDoesNotBecomeYesterday() {
        val result = AuConversationContext.yesterdayReply(listOf(ConversationEntry("Old topic", null, true)), at(0), zone)
        assertTrue(result.contains("can't reliably tell"))
        assertFalse(result.contains("Old topic"))
    }

    @Test fun recallRoutesOnlyExplicitRequests() {
        assertTrue(AuConversationContext.asksYesterdayRecap("What did we discuss yesterday?"))
        assertTrue(AuConversationContext.asksYesterdayRecap("AU, what did we talk about yesterday?"))
        assertFalse(AuConversationContext.asksYesterdayRecap("What happened yesterday?"))
        assertFalse(AuConversationContext.asksYesterdayRecap("Explain the lesson we studied yesterday"))
    }

    @Test fun olderRelevantContextSurvivesBoundedRecentWindow() {
        val relevant = RagTurn("How does photosynthesis work?", "Plants convert light into chemical energy.")
        val history = listOf(relevant, RagTurn("History", "Rome"), RagTurn("Math", "Fractions"), RagTurn("Physics", "Gravity"))
        val selected = AuConversationContext.select("Explain photosynthesis again", history, 3)
        assertEquals(listOf(relevant, history[2], history[3]), selected)
        assertTrue(AuConversationContext.select("Why?", history, 3).size <= 3)
    }

    @Test fun smallerModelRetainsSourcesAndReducesChatContext() {
        val history = (1..5).map { RagTurn("Topic $it", "A".repeat(500)) }
        val source = RagEvidence("The cell has a nucleus.", 2)
        val normal = GroundedRagPlanner.build("Explain cell structure", history, listOf(source))
        val compact = GroundedRagPlanner.build("Explain cell structure", history, listOf(source), compact = true)
        assertTrue(compact.value.length < normal.value.length)
        assertEquals(normal.evidence, compact.evidence)
        assertTrue(compact.value.contains("[1] Page 2:"))
    }
}
