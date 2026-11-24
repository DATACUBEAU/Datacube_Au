package au.datacube.app.data.rag

import java.util.Locale
import kotlin.math.ln

/**
 * Deterministic, offline preparation of extracted text for local retrieval.
 * It does not produce vectors: an on-device embedder will consume these chunks later.
 */
data class RagChunk(
    val id: String,
    val documentId: String,
    val page: Int?,
    val sequence: Int,
    val text: String
)

class RagTextChunker(
    private val chunkCharacters: Int = 800,
    private val overlapCharacters: Int = 120,
    private val maxChunks: Int = 8_000
) {
    init {
        require(chunkCharacters in 200..4_000)
        require(overlapCharacters in 0 until chunkCharacters / 2)
        require(maxChunks in 1..20_000)
    }

    private val pageMarker = Regex("(?m)^----- Page (\\d+) -----[\\t ]*\\r?\\n?")
    private val whitespace = Regex("\\s+")

    fun chunk(documentId: String, extractedText: String): List<RagChunk> {
        require(documentId.isNotBlank()) { "Document ID is required." }
        val pages = splitPages(extractedText)
        val result = ArrayList<RagChunk>()
        for ((page, body) in pages) {
            val cleaned = body.replace(whitespace, " ").trim()
            if (cleaned.isBlank()) continue
            var start = 0
            while (start < cleaned.length && result.size < maxChunks) {
                var end = minOf(start + chunkCharacters, cleaned.length)
                if (end < cleaned.length) {
                    val lastSpace = cleaned.lastIndexOf(' ', end)
                    if (lastSpace > start + chunkCharacters / 2) end = lastSpace
                }
                val segment = cleaned.substring(start, end).trim()
                if (segment.isNotBlank()) {
                    val index = result.size
                    result += RagChunk(
                        id = "$documentId:$index",
                        documentId = documentId,
                        page = page,
                        sequence = index,
                        text = segment
                    )
                }
                if (end == cleaned.length) break
                start = (end - overlapCharacters).coerceAtLeast(start + 1)
            }
            if (result.size >= maxChunks) break
        }
        return result
    }

    private fun splitPages(source: String): List<Pair<Int?, String>> {
        val matches = pageMarker.findAll(source).toList()
        if (matches.isEmpty()) return listOf(null to source)
        val pages = mutableListOf<Pair<Int?, String>>()
        if (matches.first().range.first > 0) {
            val prefix = source.substring(0, matches.first().range.first)
            if (prefix.isNotBlank()) pages += null to prefix
        }
        matches.forEachIndexed { index, marker ->
            val begin = marker.range.last + 1
            val end = matches.getOrNull(index + 1)?.range?.first ?: source.length
            pages += marker.groupValues[1].toIntOrNull() to source.substring(begin, end)
        }
        return pages
    }
}

/** Local keyword baseline for hybrid retrieval. No embedding/vector semantics are implied. */
class RagBm25Index(private val chunks: List<RagChunk>) {
    private val tokenizer = Regex("[\\p{L}\\p{N}]{2,}")
    private val tokenized = chunks.map { tokens(it.text) }
    private val frequency = tokenized.map { it.groupingBy { token -> token }.eachCount() }
    private val averageLength = tokenized.map { it.size }.average().takeUnless { it.isNaN() } ?: 0.0
    private val documentFrequency = mutableMapOf<String, Int>().apply {
        tokenized.forEach { tokens -> tokens.toSet().forEach { word -> this[word] = (this[word] ?: 0) + 1 } }
    }

    fun search(query: String, limit: Int = 5): List<RagChunk> {
        if (query.isBlank() || chunks.isEmpty()) return emptyList()
        val words = tokens(query).filterNot { it in STOP_WORDS }.toSet()
        if (words.isEmpty()) return emptyList()
        val n = chunks.size.toDouble()
        return chunks.mapIndexedNotNull { index, chunk ->
            val length = tokenized[index].size.toDouble()
            val score = words.sumOf { word ->
                val f = (frequency[index][word] ?: 0).toDouble()
                if (f == 0.0) 0.0 else {
                    val df = (documentFrequency[word] ?: 0).toDouble()
                    val idf = ln(1.0 + (n - df + 0.5) / (df + 0.5))
                    val k = 1.2
                    val b = 0.75
                    val norm = f + k * (1 - b + b * length / averageLength.coerceAtLeast(1.0))
                    idf * (f * (k + 1)) / norm
                }
            }
            if (score > 0) chunk to score else null
        }.sortedWith(compareByDescending<Pair<RagChunk, Double>> { it.second }.thenBy { it.first.sequence })
            .take(limit.coerceIn(1, 20)).map { it.first }
    }

    private fun tokens(text: String): List<String> =
        tokenizer.findAll(text.lowercase(Locale.ROOT)).map { it.value }.toList()

    companion object {
        private val STOP_WORDS = setOf("the", "and", "of", "in", "to", "is", "it", "for", "a", "an", "what", "how", "why", "does", "this", "that", "with", "from", "please", "explain", "document", "documents", "about", "you", "me", "my", "are", "on", "be", "as", "at", "do", "or")
    }
}
