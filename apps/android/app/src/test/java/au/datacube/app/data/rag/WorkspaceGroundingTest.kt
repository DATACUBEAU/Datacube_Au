package au.datacube.app.data.rag

import org.junit.Assert.*
import org.junit.Test

class WorkspaceGroundingTest {
    @Test fun weakAndInvalidSimilarityScoresAreRejected() {
        assertFalse(LocalSemanticSearch.acceptScore(Double.NaN))
        assertFalse(LocalSemanticSearch.acceptScore(0.1))
        assertFalse(LocalSemanticSearch.acceptScore(-0.5))
        assertTrue(LocalSemanticSearch.acceptScore(0.8))
    }

    @Test fun privateThoughtMarkersAndInvalidCitationsAreNotDisplayed() {
        assertEquals("Answer [8]", ModelOutputCleaner.visible("<ANALYSIS>private</ANALYSIS>Answer [8]",8))
        assertEquals("Answer ",ModelOutputCleaner.visible("Answer [9]",8))
        assertEquals("Answer",ModelOutputCleaner.visible("Answer<reasoning>private",8))
        assertEquals("Answer",ModelOutputCleaner.visible("Answer<anal",8))
    }

    @Test fun groundedPromptRequiresAbstentionWhenEvidenceDoesNotAnswer() {
        val p = GroundedRagPlanner.build("Question", emptyList(), listOf(RagEvidence("Unrelated text",1)))
        assertTrue(p.value.contains("I could not verify that in the available document passages"))
    }
}
