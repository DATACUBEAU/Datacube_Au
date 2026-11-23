package au.datacube.app.data.rag

import android.content.Context
import au.datacube.app.data.ExtractedTextStore
import au.datacube.app.data.LocalDocument
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext

data class CrossDocumentEvidence(
    val documentId: String,
    val documentName: String,
    val page: Int?,
    val text: String,
    val score: Int
)

/**
 * Bounded, purely local cross-document retrieval. Only indexed/readable
 * extracted text is searched; never claims to cover scans awaiting OCR.
 *
 * Documents are evaluated sequentially to limit phone memory and thermal load.
 * A larger production index can replace this search contract later.
 */
class CrossDocumentSearch(
    private val filesDir: File,
    private val appContext: Context? = null
) {
    constructor(context: Context) : this(context.filesDir, context.applicationContext)
    suspend fun search(
        documents: List<LocalDocument>,
        query: String,
        limit: Int = 5
    ): List<CrossDocumentEvidence> = withContext(Dispatchers.IO) {
        if (query.isBlank() || documents.isEmpty()) return@withContext emptyList()
        require(limit in 1..8)
        val result = mutableListOf<CrossDocumentEvidence>()
        val tokens = query.lowercase().split(Regex("""[^\p{L}\p{N}]+"""))
            .filter { it.length >= 4 && it !in STOP_WORDS }.distinct()
        if (tokens.isEmpty()) return@withContext emptyList()

        val persistent = appContext?.let { LocalPassageIndex(it) }
        try {
        for (document in documents) {
            currentCoroutineContext().ensureActive()
            val file = ExtractedTextStore.fileFor(filesDir, document.id)
            if (!file.isFile || file.length() <= 0L) continue
            // FTS4 indexes cover the complete extracted file. Older documents
            // without an index keep the original bounded keyword fallback.
            val indexed = runCatching {
                if (persistent?.hasCurrent(document.id, file) == true)
                    persistent.search(document.id, query, file, limit = 4)
                else null
            }.getOrNull()
            if (indexed != null) {
                indexed.forEach { passage ->
                    val titleHits = tokens.count { document.name.lowercase().contains(it) }
                    result += CrossDocumentEvidence(
                        documentId = document.id,
                        documentName = document.name,
                        page = passage.page,
                        text = passage.text.take(1100),
                        score = passage.score + titleHits * 4
                    )
                }
                continue
            }
            val preview = try {
                file.bufferedReader(Charsets.UTF_8).use { reader ->
                    val buffer = CharArray(MAX_CHARACTERS_PER_DOCUMENT)
                    val size = reader.read(buffer)
                    if (size <= 0) "" else String(buffer, 0, size)
                }
            } catch (_: Exception) {
                continue
            }
            if (preview.isBlank()) continue
            val chunks = RagTextChunker(maxChunks = 220).chunk(document.id, preview)
            val matches = RagBm25Index(chunks).search(query, limit = 3)
            for (chunk in matches) {
                val text = chunk.text.trim()
                val lower = text.lowercase()
                val matched = tokens.count { lower.contains(it) }
                val titleMatches = tokens.count { document.name.lowercase().contains(it) }
                if (matched == 0 && titleMatches == 0) continue
                result += CrossDocumentEvidence(
                    documentId = document.id,
                    documentName = document.name,
                    page = chunk.page,
                    text = text.take(1100),
                    score = (matched * 8) + (titleMatches * 4) +
                        minOf(text.length / 120, 5)
                )
            }
        }
        result.sortedWith(
            compareByDescending<CrossDocumentEvidence> { it.score }
                .thenBy { it.documentName }
        ).distinctBy { it.documentId to it.text }.take(limit)
        } finally {
            persistent?.close()
        }
    }

    companion object {
        // Bound each scan, irrespective of original document size, to prevent
        // the global chat allocating huge extracted PDFs in one phone heap.
        const val MAX_CHARACTERS_PER_DOCUMENT = 240_000
        private val STOP_WORDS = setOf(
            "about", "this", "that", "from", "what", "when", "with", "would",
            "could", "should", "which", "give", "tell", "explain", "please",
            "summary", "summarize", "your", "document", "documents", "across",
            "these", "those", "have", "their", "there"
        )
    }
}
