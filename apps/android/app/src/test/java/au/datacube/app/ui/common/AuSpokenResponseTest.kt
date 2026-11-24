package au.datacube.app.ui.common

import org.junit.Assert.*
import org.junit.Test

class AuSpokenResponseTest {
    @Test fun speaksFinalAnswerAndTableValuesWithoutMarkupOrRawLinks() {
        val raw = """
            <think>Do not read this thought.</think>
            # Storage
            **RAM** is temporary [1].
            | Type | Capacity |
            | --- | --- |
            | RAM | 8 GB |
            | SSD | 256 GB |
            See [the guide](https://example.org/help).
            Visit https://example.org/reference
        """.trimIndent()
        val speech = AuSpokenResponse.format(raw)
        assertTrue(speech.contains("RAM is temporary"))
        assertTrue(speech.contains("Row 1. Type: RAM. Capacity: 8 GB."))
        assertTrue(speech.contains("Row 2. Type: SSD. Capacity: 256 GB."))
        assertTrue(speech.contains("the guide"))
        assertFalse(speech.contains("https"))
        assertFalse(speech.contains("Do not read"))
        assertFalse(speech.contains("|"))
        assertFalse(speech.contains("[1]"))
    }

    @Test fun omitsUnfinishedThoughtAndRefersToCodeWithoutReadingIt() {
        val raw = "Visible answer.\n\u0060\u0060\u0060kotlin\nval sample = 1\n\u0060\u0060\u0060\n<analysis>Not final"
        val speech = AuSpokenResponse.format(raw)
        assertTrue(speech.contains("Visible answer."))
        assertTrue(speech.contains("code example"))
        assertFalse(speech.contains("val sample"))
        assertFalse(speech.contains("Not final"))
    }
}
