package au.datacube.app.ui.common

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AuVisualCalloutTest {
    @Test fun parsesBoundedCalloutAndSpeaksItsContent() {
        val raw = "Introduction\n[BOX] Key idea\nA useful explanation.\n[/BOX]\nConclusion"
        val blocks = AuResponseParser.parse(raw)
        assertEquals(3, blocks.size)
        assertEquals(AuResponseBlock.Callout("Key idea", "A useful explanation."), blocks[1])
        val spoken = AuSpokenResponse.format(raw)
        assertTrue(spoken.contains("Key idea"))
        assertTrue(spoken.contains("A useful explanation."))
        assertTrue(!spoken.contains("[BOX]"))
    }

    @Test fun incompleteCalloutPreservesText() {
        val blocks = AuResponseParser.parse("[BOX] Key idea\nIncomplete explanation.")
        assertTrue(blocks.any { it is AuResponseBlock.Prose && it.text.contains("Incomplete explanation") })
    }
}
