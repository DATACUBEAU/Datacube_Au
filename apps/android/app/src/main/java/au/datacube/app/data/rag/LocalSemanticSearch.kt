package au.datacube.app.data.rag

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.workDataOf
import au.datacube.app.data.DataCubeDatabase
import java.util.concurrent.TimeUnit
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
        val request = OneTimeWorkRequestBuilder<SemanticIndexWorker>()
            .setInputData(workDataOf(SemanticIndexWorker.KEY_DOCUMENT to documentId))
            .setConstraints(Constraints.Builder()
                .setRequiredNetworkType(NetworkType.NOT_REQUIRED)
                .setRequiresBatteryNotLow(true)
                .setRequiresStorageNotLow(true)
                .build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30L, TimeUnit.SECONDS)
            .build()
        work.enqueueUniqueWork(workName(documentId), ExistingWorkPolicy.KEEP, request)
    }

    fun observeIndex(documentId: String): Flow<List<WorkInfo>> =
        work.getWorkInfosForUniqueWorkFlow(workName(documentId))

    suspend fun search(documentId: String, query: String, maxResults: Int = 4): List<SemanticSearchHit> =
        withContext(Dispatchers.IO) {
            if (!supported() || query.isBlank()) return@withContext emptyList()
            val chunks = database.semanticChunks().chunks(documentId, LocalEmbeddingRuntime.MODEL_ID)
            if (chunks.isEmpty()) return@withContext emptyList()
            val queryVector = LocalEmbeddingRuntime.embed(app, query.take(6_000))
            chunks.mapNotNull { chunk ->
                if (queryVector.size != chunk.dimension) return@mapNotNull null
                runCatching {
                    val score = DenseVectorCodec.cosine(
                        queryVector, DenseVectorCodec.decode(chunk.vectorBytes, chunk.dimension)
                    )
                    if (score.isFinite()) SemanticSearchHit(chunk.text, chunk.page, score)
                    else null
                }.getOrNull()
            }.sortedByDescending { it.score }.take(maxResults.coerceIn(1, 12))
        }

    companion object {
        private fun workName(documentId: String): String = "datacube-semantic-index-$documentId"
    }
}
