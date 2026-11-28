package au.datacube.app.data.rag

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DocumentQueryInterpreterTest {
    @Test fun spellingHintsDoNotTruncateCurrentQuestion() {
        val question = "Explain the neutorn " + "with context ".repeat(40) + "and show the final example."
        val result = DocumentQueryInterpreter.understand(question, "A neutron is a neutral particle.")
        assertTrue(result.contextualQuestion?.contains(question) == true)
        assertEquals("neutron", result.correctedTerms["neutorn"])
    }

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
        assertTrue("neutorn" in plan.retrievalQuery)
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
    @Test fun ambiguousRealWordDoesNotGetSilentlyReplaced() {
        val plan = DocumentQueryInterpreter.understand(
            "What is meter?", "Matter forms objects. Matter exists in many states. Matter has mass."
        )
        assertTrue(plan.correctedTerms.isEmpty())
        assertTrue("meter" in plan.retrievalQuery)
        assertTrue(plan.clarification?.contains("matter") == true)
    }

    @Test fun existingCorrectTermIsNotChanged() {
        val plan = DocumentQueryInterpreter.understand(
            "Explain meter", "A meter measures length. Matter has mass. Matter exists."
        )
        assertTrue(plan.correctedTerms.isEmpty())
    }

    @Test fun incompleteFollowUpUsesPriorQuestionWithinSameThread() {
        val plan = DocumentQueryInterpreter.understand(
            "And why?", "Water evaporates when heated. Evaporation changes liquid into vapor.",
            previousQuestion = "What causes water evaporation?"
        )
        assertTrue(plan.clarification == null)
        assertTrue("evaporation" in plan.retrievalQuery)
        assertTrue(plan.contextualQuestion?.contains("Follow-up: And why?") == true)
    }

    @Test fun vagueQuestionWithoutContextAsksForClarification() {
        val plan = DocumentQueryInterpreter.understand(
            "And why?", "A long document about the solar system."
        )
        assertTrue(plan.clarification?.contains("Which topic") == true)
    }

    @Test fun unknownTermInShortQuestionCanAskBeforeGuessing() {
        val plan = DocumentQueryInterpreter.understand(
            "What is meter?", "The chapter defines matter in physics."
        )
        assertEquals(null, plan.correctedTerms["meter"])
        assertTrue(plan.clarification?.contains("matter") == true)
    }


    @Test fun specificDocumentQuestionDoesNotBecomeOverview() {
        val source = "ATP stores energy. Photosynthesis converts light energy."
        assertFalse(DocumentQueryInterpreter.understand("Explain ATP in this document", source).overview)
        assertFalse(DocumentQueryInterpreter.understand("Summarize photosynthesis", source).overview)
        assertTrue(DocumentQueryInterpreter.understand("Summarize the key ideas", source).overview)
    }
}
