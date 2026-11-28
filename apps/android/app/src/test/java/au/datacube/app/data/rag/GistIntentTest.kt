package au.datacube.app.data.rag

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class GistIntentTest {
    @Test fun fastPromptKeepsCurrentQuestionAndBoundsOlderResponse() {
        val history = listOf("Earlier topic" to "A".repeat(500))
        val fast = GistPrompt.build("Explain that again", history, effort = AuEffort.FAST)
        val balanced = GistPrompt.build("Explain that again", history, effort = AuEffort.BALANCED)
        assertTrue(fast.contains("Explain that again"))
        assertTrue(fast.contains("Earlier topic"))
        assertTrue(fast.length < balanced.length)
    }

    @Test fun ordinaryKnowledgeQuestionsNeedNoDocuments() {
        assertEquals(GistIntent.GENERAL, GistRequestRouter.classify("What is matter?"))
        assertEquals(GistIntent.GENERAL, GistRequestRouter.classify("How does a meter work?"))
        assertEquals(GistIntent.GENERAL, GistRequestRouter.classify("Explain what a PDF file is"))
        assertEquals(GistIntent.GENERAL, GistRequestRouter.classify("And why?"))
    }

    @Test fun localLibraryCountIsBasedOnActualMetadata() {
        assertEquals(GistIntent.LIBRARY_COUNT,
            GistRequestRouter.classify("How many documents have I uploaded?"))
        assertEquals(GistIntent.LIBRARY_COUNT,
            GistRequestRouter.classify("Count my PDFs"))
        assertEquals("You have 2 imported document(s) on this device.",
            GistRequestRouter.libraryReply(GistIntent.LIBRARY_COUNT, listOf("A.pdf", "B.pdf")))
        assertEquals("You have 0 imported document(s) on this device.",
            GistRequestRouter.libraryReply(GistIntent.LIBRARY_COUNT, emptyList()))
    }

    @Test fun explicitlyRequestedDocumentOperationsAreDetected() {
        assertEquals(GistIntent.LIBRARY_LIST,
            GistRequestRouter.classify("Show my uploaded documents"))
        assertEquals(GistIntent.DOCUMENT_SEARCH,
            GistRequestRouter.classify("What do my documents say about revenue?"))
        assertEquals(GistIntent.DOCUMENT_SEARCH,
            GistRequestRouter.classify("Compare my uploaded reports"))
    }

    @Test fun generalPromptUsesChatContextWithoutDocumentFabrication() {
        val prompt = GistPrompt.build(
            "Why is that?",
            listOf("What is matter?" to "Matter has mass and occupies space.")
        )
        assertTrue(prompt.contains("Why is that?"))
        assertTrue(prompt.contains("What is matter?"))
        assertTrue(prompt.contains("without searching imported documents"))
        assertFalse(prompt.contains("DOCUMENT SEARCH RESULTS:"))
    }
}
