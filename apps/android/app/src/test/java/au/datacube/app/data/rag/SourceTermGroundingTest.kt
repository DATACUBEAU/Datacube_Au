package au.datacube.app.data.rag

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SourceTermGroundingTest {
    @Test fun resolvesTappedWordToPageLinkedSentence() {
        val text = "An atom is a unit of matter. It has a nucleus."
        val at = text.indexOf("atom") + 2
        assertEquals("atom", SourceTermGrounding.wordAt(text, at))
        val resolved = SourceTermGrounding.find("atom", listOf(RagEvidence(text, 6)))
        assertEquals("An atom is a unit of matter.", resolved?.excerpt)
        assertEquals(6, resolved?.page)
    }
    @Test fun neverInventsDefinitionWhenSourceDoesNotContainWord() {
        assertNull(SourceTermGrounding.find("neutron",
            listOf(RagEvidence("This page explains gravity.", 3))))
    }
    @Test fun ignoresWordFragments() {
        assertNull(SourceTermGrounding.find("atom",
            listOf(RagEvidence("This is atomic physics.", 1))))
    }
}
