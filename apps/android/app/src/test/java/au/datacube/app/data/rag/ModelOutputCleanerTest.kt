package au.datacube.app.data.rag

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ModelOutputCleanerTest {
    @Test fun hidesInternalModelThinkingAndKeepsAnswer() {
        val result = ModelOutputCleaner.visible(
            "<think>Private draft reasoning.</think>The answer is 42 [1].", 2
        )
        assertFalse(result.contains("draft reasoning"))
        assertEquals("The answer is 42 [1].", result)
    }

    @Test fun hidesUnfinishedThoughtWhileStreaming() {
        val visible = ModelOutputCleaner.visible("<think>Working on", 2)
        assertTrue(visible.isBlank())
    }

    @Test fun rejectsUnknownCitations() {
        val result = ModelOutputCleaner.visible("Evidence [1], invented [9].", 2)
        assertTrue(result.contains("[1]"))
        assertFalse(result.contains("[9]"))
    }
}
