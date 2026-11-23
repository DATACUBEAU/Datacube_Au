package au.datacube.app.ui.voice

import org.junit.Assert.assertEquals
import org.junit.Test

class VoicePromptMergeTest {
    @Test fun appendsRecognizedWordsWithoutSubmitting() {
        assertEquals("Explain chapter two", mergeVoicePrompt("Explain", "  chapter   two  "))
    }

    @Test fun blankRecognitionKeepsTypedQuestion() {
        assertEquals("What is RAG?", mergeVoicePrompt("What is RAG?", "  "))
    }

    @Test fun dictationIsBoundedByChatLimit() {
        assertEquals(500, mergeVoicePrompt("test", "word ".repeat(150)).length)
    }
}
