package au.datacube.app.data.rag

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RagTextChunkerTest {
    private val chunker = RagTextChunker(chunkCharacters = 240, overlapCharacters = 40)

    @Test fun keepsPdfPageProvenance() {
        val source = "----- Page 1 -----\n" + "gravity acts on masses. ".repeat(18) +
            "\n\n----- Page 2 -----\n" + "electromagnetism describes fields. ".repeat(15)
        val chunks = chunker.chunk("physics", source)
        assertTrue(chunks.size > 2)
        assertTrue(chunks.any { it.page == 1 })
        assertTrue(chunks.any { it.page == 2 })
        assertTrue(chunks.filter { it.page == 1 }.all { "electromagnetism" !in it.text })
        assertTrue(chunks.filter { it.page == 2 }.all { "gravity" !in it.text })
        assertEquals(chunks.indices.map { "physics:$it" }, chunks.map { it.id })
    }

    @Test fun overlapPreservesTextContinuityWithoutInfiniteLoop() {
        val source = (1..150).joinToString(" ") { "term$it" }
        val chunks = chunker.chunk("a", source)
        assertTrue(chunks.size in 2..100)
        assertTrue(chunks.all { it.text.isNotBlank() && it.text.length <= 240 })
        assertTrue(chunks.first().text.startsWith("term1"))
        assertTrue(chunks.last().text.endsWith("term150"))
    }

    @Test fun emptyPagesAreSkippedAndTextFilesRemainUnpaged() {
        assertTrue(chunker.chunk("id", "").isEmpty())
        val plain = chunker.chunk("id", "A locally extracted study paragraph.")
        assertEquals(1, plain.size)
        assertEquals(null, plain.first().page)
        assertEquals("A locally extracted study paragraph.", plain.first().text)
        val page = chunker.chunk("id", "----- Page 2 -----\n\n----- Page 3 -----\nOnly this page has text.")
        assertEquals(1, page.size)
        assertEquals(3, page.single().page)
    }

    @Test fun bm25ReturnsRelevantPassageWithoutInventingVectors() {
        val chunks = chunker.chunk("notes",
            "----- Page 1 -----\nIsaac Newton described gravity and how masses attract.\n" +
            "----- Page 2 -----\nElectric circuits have current, resistance and voltage.")
        val ranked = RagBm25Index(chunks).search("voltage resistance")
        assertFalse(ranked.isEmpty())
        assertEquals(2, ranked.first().page)
        assertTrue(RagBm25Index(chunks).search("unrelatedkeyword").isEmpty())
    }
}
