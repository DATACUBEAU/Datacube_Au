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
    @Test fun rendersCompleteFlowAndNarratesSteps() {
        val raw = "Overview\n[FLOW] Water cycle\nEvaporation\nCondensation\nPrecipitation\n[/FLOW]\nSummary"
        val blocks = AuResponseParser.parse(raw)
        assertEquals(AuResponseBlock.Flow("Water cycle", listOf("Evaporation", "Condensation", "Precipitation")), blocks[1])
        val spoken = AuSpokenResponse.format(raw)
        assertTrue(spoken.contains("Step 2. Condensation"))
        assertTrue(!spoken.contains("[FLOW]"))
    }

    @Test fun incompleteOrOversizedFlowFallsBackToReadableText() {
        assertTrue(AuResponseParser.parse("[FLOW] Cycle\nFirst\nSecond").none { it is AuResponseBlock.Flow })
        assertTrue(AuResponseParser.parse("[FLOW] Cycle\n" + (1..7).joinToString("\n") { "Step $it" } + "\n[/FLOW]").none { it is AuResponseBlock.Flow })
    }
}
