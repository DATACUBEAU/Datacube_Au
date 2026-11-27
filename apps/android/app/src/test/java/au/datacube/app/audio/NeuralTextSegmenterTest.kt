package au.datacube.app.audio

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NeuralTextSegmenterTest {
    @Test fun retainsEveryWordAndKeepsSpeechChunksBounded() {
        val input = "Kotlin makes apps. ".repeat(75).trim()
        val chunks = NeuralTextSegmenter.split(input)
        assertTrue(chunks.size > 1)
        assertTrue(chunks.all { it.length <= 260 })
        assertEquals(input, chunks.joinToString(" "))
    }

    @Test fun longAnswersAreNotSilentlyTruncated() {
        val input = ("Natural sentences should continue without skipping words. ").repeat(320).trim()
        val chunks = NeuralTextSegmenter.split(input, maxChunk = 600, maxText = 12000)
        assertEquals(input, chunks.joinToString(" "))
        assertTrue(chunks.all { it.length <= 600 })
    }

    @Test fun ignoresWhitespaceAndEmptyInput() {
        assertTrue(NeuralTextSegmenter.split(" \n \t ").isEmpty())
    }

    @Test fun longUnbrokenTextStillTerminates() {
        val chunks = NeuralTextSegmenter.split("a".repeat(1500))
        assertTrue(chunks.isNotEmpty())
        assertTrue(chunks.all { it.length <= 260 })
    }
}
