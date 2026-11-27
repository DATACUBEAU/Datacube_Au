package au.datacube.app.data.rag

import android.content.Context
import androidx.work.ExistingWorkPolicy
import au.datacube.app.work.DocumentWorkPolicy
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.workDataOf
import au.datacube.app.data.DataCubeDatabase
import au.datacube.app.data.ExtractedTextStore
import java.security.MessageDigest
import java.util.PriorityQueue
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.withContext

data class SemanticSearchHit(val text: String, val page: Int?, val score: Double)

/** Local-only, fail-closed vector index; BM25 remains the fallback when unavailable. */
class LocalSemanticSearch(private val context: Context) {
    private val app = context.applicationContext
    private val work = WorkManager.getInstance(app)
    private val database = DataCubeDatabase.get(app)

    fun supported(): Boolean = LocalEmbeddingRuntime.available(app)

    fun scheduleIndex(documentId: String) {
        if (!supported() || documentId.isBlank()) return
        val request = DocumentWorkPolicy.request(SemanticIndexWorker::class.java,
            workDataOf(SemanticIndexWorker.KEY_DOCUMENT to documentId))
        work.enqueueUniqueWork(workName(documentId), ExistingWorkPolicy.KEEP, request)
    }

    internal suspend fun updateLegacyRequest(documentId: String) {
        DocumentWorkPolicy.updateLegacy(work, workName(documentId), SemanticIndexWorker::class.java,
            workDataOf(SemanticIndexWorker.KEY_DOCUMENT to documentId))
    }

    fun cancelIndex(documentId: String) {
        work.cancelUniqueWork(workName(documentId))
    }

    fun observeIndex(documentId: String): Flow<List<WorkInfo>> =
        work.getWorkInfosForUniqueWorkFlow(workName(documentId))

    suspend fun search(documentId: String, query: String, maxResults: Int = 4): List<SemanticSearchHit> =
        withContext(Dispatchers.IO) {
            if (!supported() || query.isBlank()) return@withContext emptyList()
            // Do not load/run the embedding model when this document has no vector index.
            val indexedHash = database.semanticChunks().sourceHash(documentId, LocalEmbeddingRuntime.MODEL_ID)
                ?: return@withContext emptyList()
            val source = ExtractedTextStore.fileFor(app.filesDir, documentId)
            if (!source.isFile || source.length() > 100L * 1024 * 1024) return@withContext emptyList()
            val digest = MessageDigest.getInstance("SHA-256")
            source.inputStream().buffered().use { input ->
                val buffer = ByteArray(64 * 1024)
                while (true) {
                    currentCoroutineContext().ensureActive()
                    val n = input.read(buffer)
                    if (n < 0) break
                    digest.update(buffer,0,n)
                }
            }
            if (indexedHash != digest.digest().joinToString("") { "%02x".format(it) }) return@withContext emptyList()
            val queryVector = LocalEmbeddingRuntime.embed(app, query.take(6_000))
            val count = maxResults.coerceIn(1, 12)
            val best = PriorityQueue<SemanticSearchHit>(compareBy { it.score })
            var after = -1
            while (true) {
                currentCoroutineContext().ensureActive()
                val page = database.semanticChunks().chunkPageAfter(
                    documentId, LocalEmbeddingRuntime.MODEL_ID, after, 64
                )
                if (page.isEmpty()) break
                for (chunk in page) {
                    if (chunk.sourceHash != indexedHash || queryVector.size != chunk.dimension) continue
                    val score = runCatching {
                        DenseVectorCodec.cosine(
                            queryVector, DenseVectorCodec.decode(chunk.vectorBytes, chunk.dimension)
                        )
                    }.getOrNull() ?: continue
                    if (!acceptScore(score)) continue
                    val candidate = SemanticSearchHit(chunk.text, chunk.page, score)
                    if (best.size < count) best.add(candidate)
                    else if (score > best.peek().score) {
                        best.poll()
                        best.add(candidate)
                    }
                }
                after = page.last().ordinal
            }
            best.toList().sortedByDescending { it.score }
        }

    companion object {
        // Conservative initial threshold; tune with labelled retrieval benchmarks.
        // Similarity is not evidence verification or a probability of correctness.
        internal fun acceptScore(score: Double): Boolean = score.isFinite() && score >= 0.65 && score <= 1.0
        private fun workName(documentId: String): String = "datacube-semantic-index-$documentId"
    }
}
