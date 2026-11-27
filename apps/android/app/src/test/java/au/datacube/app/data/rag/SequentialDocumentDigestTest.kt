package au.datacube.app.data.rag

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SequentialDocumentDigestTest {
    @Test fun everyCharacterSurvivesBoundedSequentialReading() {
        val input = (1..9000).joinToString("\n") { "Section $it: key facts and a relationship." }
        val chunks = input.reader().buffered().use { reader ->
            generateSequence { SequentialDocumentDigest.nextChunk(reader) }.toList()
        }
        assertTrue(chunks.size > 10)
        assertTrue(chunks.all { it.length <= 7000 })
        assertEquals(input, chunks.joinToString(""))
    }

    @Test fun neverSplitsSurrogatePairsAtChunkBoundary() {
        val input = "x".repeat(6999) + "😀" + "y".repeat(8000)
        val chunks = input.reader().buffered().use { reader ->
            generateSequence { SequentialDocumentDigest.nextChunk(reader) }.toList()
        }
        assertEquals(input, chunks.joinToString(""))
        assertTrue(chunks.none { it.last().isHighSurrogate() || it.first().isLowSurrogate() })
    }
}
