package au.datacube.app.data.rag

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.assertThrows
import org.junit.Test

class GroundedRagPlannerTest {
    @Test fun fusionCombinesRankingsAndAvoidsDuplicateSource() {
        val gravity = RagEvidence("Gravity attracts masses.", 1)
        val circuit = RagEvidence("A circuit carries current.", 2)
        val ranked = GroundedRagPlanner.fuse(
            keyword = listOf(gravity, circuit),
            semantic = listOf(circuit, gravity)
        )
        assertEquals(2, ranked.size)
        assertEquals(setOf(gravity, circuit), ranked.toSet())
    }

    @Test fun promptIncludesOnlySourceAndBoundedConversationMemory() {
        val history = (1..9).map { RagTurn("Question $it", "Answer $it") }
        val prompt = GroundedRagPlanner.build(
            "What does gravity do?", history,
            listOf(RagEvidence("Gravity causes objects with mass to attract.", 7))
        )
        assertTrue(prompt.value.contains("[1] Page 7:"))
        assertTrue(prompt.value.contains("Previous user 1: Question 7"))
        assertFalse(prompt.value.contains("Question 6"))
        assertTrue(prompt.value.contains("not evidence"))
    }

    @Test fun rejectsEvidenceFreePrompt() {
        assertThrows(IllegalArgumentException::class.java) {
            GroundedRagPlanner.build("What is in this file?", emptyList(), emptyList())
        }
    }

    @Test fun trimsOversizedPassagesAndHistory() {
        val longText = "physics ".repeat(2_000)
        val prompt = GroundedRagPlanner.build(
            "Explain this",
            listOf(RagTurn("X".repeat(2_000), "Y".repeat(2_000))),
            listOf(RagEvidence(longText, null))
        )
        assertTrue(prompt.value.length < 11_500)
    }
}
