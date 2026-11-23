package au.datacube.app.audio

import au.datacube.app.data.rag.RagEvidence
import au.datacube.app.data.rag.RagTextChunker
import au.datacube.app.data.rag.StudyContentQuality
import java.io.File
import java.io.RandomAccessFile
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive

/**
 * Selects representative source evidence from different positions in large
 * extracted documents. Reads at most 12 × 9 KiB, never loads a 20 MB book
 * into memory. Samples are supporting excerpts, not a full-document proof.
 */
object PodcastSourceSampler {
    private const val WINDOW_BYTES = 9_216
    private const val MAX_WINDOWS = 12

    suspend fun sample(
        sourceFile: File?,
        documentId: String,
        preview: String
    ): List<RagEvidence> {
        val pieces = mutableListOf<String>()
        if (sourceFile != null && sourceFile.isFile && sourceFile.length() > 0L) {
            RandomAccessFile(sourceFile, "r").use { input ->
                val length = input.length()
                val samples = minOf(MAX_WINDOWS,
                    ((length + WINDOW_BYTES - 1) / WINDOW_BYTES).toInt().coerceAtLeast(1))
                val maximumStart = (length - WINDOW_BYTES).coerceAtLeast(0)
                for (index in 0 until samples) {
                    currentCoroutineContext().ensureActive()
                    val start = if (samples == 1) 0L
                        else maximumStart * index / (samples - 1)
                    input.seek(start)
                    val count = minOf(WINDOW_BYTES.toLong(), length - start).toInt()
                    if (count <= 0) continue
                    val bytes = ByteArray(count)
                    input.readFully(bytes)
                    var excerpt = bytes.toString(Charsets.UTF_8)
                    // Discard likely partial leading and trailing words without
                    // needing a full UTF-8 document buffer.
                    if (start > 0 && excerpt.length > 180) {
                        excerpt = excerpt.drop(90)
                    }
                    if (start + count < length && excerpt.length > 180) {
                        excerpt = excerpt.dropLast(90)
                    }
                    if (excerpt.isNotBlank()) pieces.add(excerpt)
                }
            }
        }
        if (pieces.isEmpty()) pieces += preview.take(48_000)

        val selected = mutableListOf<RagEvidence>()
        val dedupe = mutableSetOf<String>()
        for (piece in pieces) {
            currentCoroutineContext().ensureActive()
            val chunks = RagTextChunker(maxChunks = 18).chunk(documentId, piece)
            val best = chunks.map { RagEvidence(it.text, null) }
                .filter { StudyContentQuality.score(it.text) > 0 }
                .maxByOrNull { StudyContentQuality.score(it.text) }
            if (best != null) {
                val clean = StudyContentQuality.cleanExcerpt(best.text).take(950)
                val key = clean.lowercase()
                if (clean.length >= 80 && dedupe.add(key)) {
                    selected += RagEvidence(clean, null)
                }
            }
        }
        return selected.take(8)
    }
}
