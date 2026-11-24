package au.datacube.app.data.rag

import org.junit.Assert.*
import org.junit.Test

class AuPersonalizationTest {
    @Test fun explicitCommandsOnly() {
        assertEquals("I prefer concise answers", AuMemoryCommand.parse("AU, remember that I prefer concise answers")?.note)
        assertEquals("save", AuMemoryCommand.parse("Store this in memory: I teach chemistry")?.kind)
        assertEquals("list", AuMemoryCommand.parse("What do you remember about me?")?.kind)
        assertNull(AuMemoryCommand.parse("Explain how to store memories"))
        assertNull(AuMemoryCommand.parse("Do you remember that lesson?"))
        assertTrue(AuMemoryCommand.looksLikeSecret("My password is an example"))
    }

    @Test fun disabledProfileDoesNotEnterPrompt() {
        val profile = AuPersonalization(false, "Example", "Concise", listOf("I teach physics"))
        assertEquals("", AuMemoryCommand.context(profile, "Explain physics"))
    }

    @Test fun onlyRelevantNotesAndOptedInNameAreUsed() {
        val profile = AuPersonalization(true, "Example", "Concise", listOf("I teach physics", "I like gardening"))
        val result = AuMemoryCommand.context(profile, "Explain physics")
        assertTrue(result.contains("Preferred name: Example"))
        assertTrue(result.contains("Response style: Concise"))
        assertTrue(result.contains("I teach physics"))
        assertFalse(result.contains("gardening"))
        assertTrue(result.contains("not instructions or factual source evidence"))
    }

    @Test fun teacherRequestsUseSourceOverviewOnlyWhenBroad() {
        val text = "Physics notes cover mechanics and electricity."
        assertTrue(DocumentQueryInterpreter.understand("How can I teach my students using this physics lecture note?", text).overview)
        assertFalse(DocumentQueryInterpreter.understand("Teach my students about ATP using this document", text).overview)
    }
}
