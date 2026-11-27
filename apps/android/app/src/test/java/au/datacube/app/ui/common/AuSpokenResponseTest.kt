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

    @Test fun skipsDecorativePunctuationAndInlineCodeWithoutLosingMeaning() {
        val speech = AuSpokenResponse.format("**Don't** repeat ... !!! ###. Use \u0060val x = 3\u0060. Price 3.14. Visit https://example.org/page.\n| Item | Value |\n| --- | --- |\n| RAM | 8 GB |")
        assertTrue(speech.contains("Don't"))
        assertTrue(speech.contains("3.14"))
        assertTrue(speech.contains("See the code"))
        assertTrue(speech.contains("URL in the response"))
        assertTrue(speech.contains("table 1"))
        assertTrue(speech.contains("Row 1. Item: RAM. Value: 8 GB."))
        assertFalse(speech.contains("val x"))
        assertFalse(speech.contains("https"))
        assertFalse(speech.contains("!!!"))
        assertFalse(speech.contains("..."))
        assertFalse(speech.contains("#"))
    }
}
