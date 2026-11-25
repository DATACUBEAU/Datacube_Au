package au.datacube.app.data.rag

import org.junit.Assert.*
import org.junit.Test

class AuFollowUpTest {
    @Test fun ambiguousContinuationRetainsActualOptions() {
        val turns = listOf(RagTurn("What is this document about?", "Biology overview."),
            RagTurn("Is that it?", "Which would help?\nA. Cells\nB. Genetics"))
        val result = AuFollowUp.resolve("Okay, go on",turns,true)
        assertTrue(result.reply.orEmpty().contains("A. Cells"))
        assertTrue(result.reply.orEmpty().contains("B. Genetics"))
        assertEquals("Explain Cells",AuFollowUp.resolve("go on with section A",turns,true).query)
    }

    @Test fun standaloneAndNewTopicsAreNotInvented() {
        assertNotNull(AuFollowUp.resolve("go on",emptyList(),true).reply)
        val history = listOf(RagTurn("What is ATP?","ATP transfers energy."))
        assertEquals("What is mitosis?",AuFollowUp.resolve("What is mitosis?",history,true).query)
        assertTrue(AuFollowUp.resolve("tell me more",history,true).query.contains("ATP"))
    }
}
