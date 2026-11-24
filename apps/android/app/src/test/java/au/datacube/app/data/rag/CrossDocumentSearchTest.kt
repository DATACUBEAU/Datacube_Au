package au.datacube.app.data.rag

import au.datacube.app.data.ExtractedTextStore
import au.datacube.app.data.LocalDocument
import java.nio.file.Files
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CrossDocumentSearchTest {
    private fun document(id: String, title: String) = LocalDocument(
        id = id, name = title, extension = "pdf",
        mimeType = "application/pdf", sizeBytes = 1024,
        privatePath = "/test/$id.pdf", createdAtEpochMs = 100L
    )

    @Test fun globalSearchFindsCorrectDocumentAndKeepsPageAndName() = runBlocking {
        val root = Files.createTempDirectory("discs-search").toFile()
        try {
            val a = document("flutter", "Flutter mobile development")
            val b = document("biology", "Biology notes")
            ExtractedTextStore.fileFor(root, a.id).apply {
                parentFile?.mkdirs()
                writeText("----- Page 7 -----\nFlutter builds cross-platform mobile applications. Widgets describe the graphical interface and application behavior.")
            }
            ExtractedTextStore.fileFor(root, b.id).apply {
                parentFile?.mkdirs()
                writeText("----- Page 2 -----\nPhotosynthesis is the process by which plants convert light energy into chemical energy.")
            }
            val result = CrossDocumentSearch(root).search(listOf(a, b), "Flutter application widgets")
            assertTrue(result.isNotEmpty())
            assertTrue(result.all { it.documentId == "flutter" })
            assertEquals("Flutter mobile development", result.first().documentName)
            assertEquals(7, result.first().page)
            assertTrue(result.first().text.contains("Widgets"))
        } finally {
            root.deleteRecursively()
        }
    }

    @Test fun crossDocumentSearchDoesNotInventResultsWhenNothingMatches() = runBlocking {
        val root = Files.createTempDirectory("discs-empty").toFile()
        try {
            val results = CrossDocumentSearch(root).search(listOf(document("missing", "Lost file")), "transformers")
            assertTrue(results.isEmpty())
        } finally { root.deleteRecursively() }
    }

    @Test fun newContextStartsAtZeroAndWarningsAreBounded() {
        assertEquals(null, ConversationWindow.warning(0))
        assertTrue(ConversationWindow.warning(16)!!.contains("long"))
        assertTrue(ConversationWindow.warning(20)!!.contains("New chat", ignoreCase = true))
        assertFalse(LocalConversationThreads.historyKey("doc123", "main").contains("--"))
        assertTrue(LocalConversationThreads.historyKey("doc123", "thread123").contains("--"))
    }

    @Test fun shortTechnicalTermsDoNotMatchSubstringsOrTitlesAlone() = runBlocking {
        val root = Files.createTempDirectory("short-terms").toFile()
        try {
            val a = document("ai", "AI notes")
            val b = document("air", "Air science")
            val c = document("title", "AI title only")
            listOf(a to "AI means artificial intelligence.", b to "Air contains nitrogen.", c to "Water freezes at zero degrees.").forEach { (doc, body) ->
                ExtractedTextStore.fileFor(root, doc.id).apply { parentFile?.mkdirs(); writeText(body) }
            }
            val hits = CrossDocumentSearch(root).search(listOf(a, b, c), "What is AI?")
            assertEquals(listOf("ai"), hits.map { it.documentId }.distinct())
        } finally { root.deleteRecursively() }
    }
}
