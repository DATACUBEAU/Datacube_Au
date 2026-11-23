package au.datacube.app.data.rag

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DocumentQueryInterpreterTest {
    @Test fun naturalOverviewQuestionDoesNotRunKeywordMatchingForGenericWords() {
        val result = DocumentQueryInterpreter.understand(
            "What is in this documnt?", "The book explains physics and motion."
        )
        assertTrue(result.overview)
    }

    @Test fun shortSummaryRequestUsesSourceOverview() {
        assertTrue(DocumentQueryInterpreter.understand(
            "Summarize the key ideas", "A study note."
        ).overview)
    }

    @Test fun typoMatchesUniqueTermActuallyPresentInDocument() {
        val plan = DocumentQueryInterpreter.understand(
            "Explain the neutorn", "A neutron is a neutral particle. A neutron is in an atom."
        )
        assertFalse(plan.overview)
        assertEquals("neutron", plan.correctedTerms["neutorn"])
        assertTrue("neutron" in plan.retrievalQuery)
    }

    @Test fun unknownTermsAreNotInvented() {
        val plan = DocumentQueryInterpreter.understand(
            "Define quantumheliodynamics", "A chapter about gravity."
        )
        assertTrue(plan.correctedTerms.isEmpty())
    }

    @Test fun keyboardTranspositionIsWithinOneEdit() {
        assertEquals(1, DocumentQueryInterpreter.distance("neutorn", "neutron", 2))
    }
}
