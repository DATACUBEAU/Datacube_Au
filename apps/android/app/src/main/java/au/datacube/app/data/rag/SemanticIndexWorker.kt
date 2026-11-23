package au.datacube.app.data.rag

import android.content.Context
import androidx.room.withTransaction
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import au.datacube.app.data.DataCubeDatabase
import au.datacube.app.data.ExtractedTextStore
import java.security.MessageDigest
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext

/** Creates REAL vectors using the downloaded EmbeddingGemma2 model; never uses mock inference. */
class SemanticIndexWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val id = inputData.getString(KEY_DOCUMENT).orEmpty()
        if (id.isBlank()) return@withContext Result.failure(workDataOf(KEY_ERROR to "Document ID missing."))
        if (!LocalEmbeddingRuntime.available(applicationContext)) {
            return@withContext Result.failure(workDataOf(KEY_ERROR to "Download the EmbeddingGemma 2 search model."))
        }
        val db = DataCubeDatabase.get(applicationContext)
        try {
            checkNotNull(db.documents().find(id)) { "Document no longer exists." }
            val extracted = ExtractedTextStore.fileFor(applicationContext.filesDir, id)
            check(extracted.isFile) { "Document extraction is not finished." }
            require(extracted.length() <= 21L * 1024 * 1024) { "Extracted document exceeds the index size limit." }
            val input = extracted.readBytes()
            val hash = MessageDigest.getInstance("SHA-256").digest(input)
                .joinToString("") { "%02x".format(it) }
            if (db.semanticChunks().sourceHash(id, LocalEmbeddingRuntime.MODEL_ID) == hash) {
                return@withContext Result.success()
            }
            val chunks = RagTextChunker(maxChunks = 8_000).chunk(id, input.toString(Charsets.UTF_8))
            if (chunks.isEmpty()) return@withContext Result.failure(workDataOf(KEY_ERROR to "No readable text to index."))
            // Do not silently truncate a large source. Streaming indexing follows in optimization.
            check(chunks.size < 8_000) { "This document needs the large-document indexing pipeline." }
            val vectors = ArrayList<SemanticVectorChunk>(chunks.size)
            var size: Int? = null
            chunks.forEachIndexed { index, chunk ->
                currentCoroutineContext().ensureActive()
                val embedding = LocalEmbeddingRuntime.embed(applicationContext, chunk.text)
                if (size == null) size = embedding.size
                check(embedding.size == size) { "Embedding dimensions changed during indexing." }
                vectors += SemanticVectorChunk(
                    documentId = id,
                    modelId = LocalEmbeddingRuntime.MODEL_ID,
                    ordinal = chunk.sequence,
                    page = chunk.page,
                    text = chunk.text,
                    sourceHash = hash,
                    dimension = embedding.size,
                    vectorBytes = DenseVectorCodec.encode(embedding)
                )
                if (index % 10 == 0 || index == chunks.lastIndex) {
                    setProgress(workDataOf(KEY_PROGRESS to ((index + 1) * 100 / chunks.size), KEY_COUNT to (index + 1)))
                }
            }
            currentCoroutineContext().ensureActive()
            // Atomic publication: do not expose a partially populated index.
            db.withTransaction {
                checkNotNull(db.documents().find(id)) { "Document deleted during indexing." }
                db.semanticChunks().clear(id, LocalEmbeddingRuntime.MODEL_ID)
                db.semanticChunks().insertAll(vectors)
            }
            Result.success(workDataOf(KEY_COUNT to vectors.size))
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: Exception) {
            Result.failure(workDataOf(KEY_ERROR to (error.message ?: "Local indexing failed.")))
        }
    }

    companion object {
        const val KEY_DOCUMENT = "documentId"
        const val KEY_PROGRESS = "percentage"
        const val KEY_COUNT = "indexedChunks"
        const val KEY_ERROR = "error"
    }
}
