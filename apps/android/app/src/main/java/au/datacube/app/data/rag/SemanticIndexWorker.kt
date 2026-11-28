package au.datacube.app.data.rag

import android.content.Context
import androidx.room.withTransaction
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import au.datacube.app.data.DataCubeDatabase
import au.datacube.app.data.ExtractedTextStore
import au.datacube.app.notifications.LocalNotificationService
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext

/** Build real embeddings from the committed FTS index. Staged vectors remain
 * invisible to search; each committed batch survives interruption. */
class SemanticIndexWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val id = inputData.getString(KEY_DOCUMENT).orEmpty()
        if (!id.matches(Regex("[A-Za-z0-9_-]{1,80}"))) return@withContext Result.failure()
        if (!LocalEmbeddingRuntime.available(applicationContext))
            return@withContext Result.failure(workDataOf(KEY_ERROR to "Download the EmbeddingGemma 2 search model."))
        val db = DataCubeDatabase.get(applicationContext)
        val dao = db.semanticChunks()
        val model = LocalEmbeddingRuntime.MODEL_ID
        val staging = "$model:staging"
        val notifications = LocalNotificationService(applicationContext)
        val index = LocalPassageIndex(applicationContext)
        try {
            checkNotNull(db.documents().find(id)) { "Document no longer exists." }
            val extracted = ExtractedTextStore.fileFor(applicationContext.filesDir, id)
            check(extracted.isFile) { "Document extraction is not finished." }
            val snapshot = index.snapshot(id, extracted)
            if (snapshot == null) {
                if (runAttemptCount < 8) {
                    LexicalIndexWorker.schedule(applicationContext, id)
                    return@withContext Result.retry()
                }
                return@withContext Result.failure(workDataOf(KEY_ERROR to "Document search index is not ready."))
            }
            val hash = snapshot.sourceHash
            val total = snapshot.count
            if (dao.sourceHash(id, model) == hash && dao.count(id, model) == total) {
                dao.clear(id, staging)
                return@withContext Result.success(workDataOf(KEY_COUNT to total))
            }
            if (dao.sourceHash(id, staging) != hash) dao.clear(id, staging)
            var done = dao.count(id, staging)
            if (done > total) { dao.clear(id, staging); done = 0 }
            var rowId = if (done == 0) 0L else index.rowIdForOrdinal(id, done - 1)
                ?: error("The source index changed during embedding preparation.")
            var dimension = dao.chunkPageAfter(id, staging, -1, 1).firstOrNull()?.dimension
            val initialPercent = (done * 100L / total).toInt()
            val foreground = notifications.startDocumentWorker(this@SemanticIndexWorker,
                "Preparing semantic search · $initialPercent%", initialPercent)
            while (done < total) {
                currentCoroutineContext().ensureActive()
                check(applicationContext.filesDir.usableSpace > 32L * 1024 * 1024) { "Free storage before continuing semantic indexing." }
                check(index.snapshot(id, extracted) == snapshot) { "Document changed during indexing." }
                val batch = index.batchAfter(id, rowId, 32)
                check(batch.isNotEmpty()) { "Source index is incomplete." }
                val vectors = ArrayList<SemanticVectorChunk>(batch.size)
                for ((nextRowId, chunk) in batch) {
                    currentCoroutineContext().ensureActive()
                    check(chunk.ordinal == done + vectors.size) { "Source index sequence changed." }
                    val vector = LocalEmbeddingRuntime.embed(applicationContext, chunk.text, background = true)
                    if (dimension == null) dimension = vector.size
                    check(vector.size == dimension) { "Embedding dimensions changed." }
                    vectors += SemanticVectorChunk(id, staging, chunk.ordinal, chunk.page, chunk.text,
                        hash, vector.size, DenseVectorCodec.encode(vector))
                    rowId = nextRowId
                }
                checkNotNull(db.documents().find(id)) { "Document deleted during indexing." }
                dao.insertAll(vectors)
                done += vectors.size
                val percent = (done * 100L / total).toInt()
                setProgress(workDataOf(KEY_PROGRESS to percent, KEY_COUNT to done))
                notifications.updateDocumentWorker(this@SemanticIndexWorker, id, foreground,
                    "Embedding passages · $percent% ($done of $total)", percent)
            }
            check(index.snapshot(id, extracted) == snapshot) { "Document changed during indexing." }
            db.withTransaction {
                checkNotNull(db.documents().find(id))
                check(dao.count(id, staging) == total)
                dao.clear(id, model)
                check(dao.publishStaged(id, staging, model) == total)
            }
            notifications.showSemanticComplete(id)
            Result.success(workDataOf(KEY_COUNT to total))
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (pressure: DeviceComputePressure) {
            // Previously committed staging batches remain intact for the next run.
            Result.retry()
        } catch (error: Exception) {
            // Keep the exact failure locally for troubleshooting; do not expose source text in notifications.
            android.util.Log.w("AuSemanticIndex", "Embedding indexing failed: " + error.javaClass.simpleName)
            if (db.documents().find(id) != null) notifications.showSemanticFailed(id)
            Result.failure(workDataOf(KEY_ERROR to (error.message ?: "Local semantic indexing failed.").take(400)))
        } finally {
            index.close()
            notifications.clearDocumentProgress(id)
        }
    }

    companion object {
        const val KEY_DOCUMENT = "documentId"
        const val KEY_PROGRESS = "percentage"
        const val KEY_COUNT = "indexedChunks"
        const val KEY_ERROR = "error"
    }
}
