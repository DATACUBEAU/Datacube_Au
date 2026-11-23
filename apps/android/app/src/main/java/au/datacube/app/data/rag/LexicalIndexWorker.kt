package au.datacube.app.data.rag

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import au.datacube.app.data.DataCubeDatabase
import au.datacube.app.data.ExtractedTextStore
import au.datacube.app.notifications.LocalNotificationService
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Local FTS4 indexing is separate from optional neural embeddings.
 * It neither downloads models nor delays opening an extracted document.
 */
class LexicalIndexWorker(context: Context, parameters: WorkerParameters) :
    CoroutineWorker(context, parameters) {

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val documentId = inputData.getString(KEY_DOCUMENT).orEmpty()
        if (!documentId.matches(Regex("[A-Za-z0-9_-]{1,80}"))) {
            return@withContext Result.failure(workDataOf(KEY_ERROR to "Invalid document reference."))
        }
        val db = DataCubeDatabase.get(applicationContext)
        val notifications = LocalNotificationService(applicationContext)
        val index = LocalPassageIndex(applicationContext)
        try {
            checkNotNull(db.documents().find(documentId)) { "Document was deleted." }
            val file = ExtractedTextStore.fileFor(applicationContext.filesDir, documentId)
            if (index.hasCurrent(documentId, file)) return@withContext Result.success()
            notifications.showDocumentSearchIndexing(documentId, 0)
            val count = index.build(documentId, file) { completed ->
                setProgress(workDataOf(KEY_COUNT to completed))
                notifications.showDocumentSearchIndexing(documentId, completed)
            }
            // A deleted document must never publish a new ready notification.
            if (db.documents().find(documentId) != null) {
                notifications.showIndexComplete(documentId)
            } else {
                index.remove(documentId)
            }
            Result.success(workDataOf(KEY_COUNT to count))
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: Exception) {
            Result.failure(workDataOf(KEY_ERROR to
                (error.message ?: "AU could not finish building the document search index.")))
        } finally {
            index.close()
            notifications.clearDocumentProgress(documentId)
        }
    }

    companion object {
        const val KEY_DOCUMENT = "documentId"
        const val KEY_COUNT = "indexedPassages"
        const val KEY_ERROR = "error"
        private fun workName(documentId: String) = "datacube-lexical-index-$documentId"

        fun schedule(context: Context, documentId: String) {
            if (!documentId.matches(Regex("[A-Za-z0-9_-]{1,80}"))) return
            val request = OneTimeWorkRequestBuilder<LexicalIndexWorker>()
                .setInputData(workDataOf(KEY_DOCUMENT to documentId))
                .setConstraints(Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.NOT_REQUIRED)
                    .setRequiresBatteryNotLow(true)
                    .setRequiresStorageNotLow(true)
                    .build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30L, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context.applicationContext)
                .enqueueUniqueWork(workName(documentId), ExistingWorkPolicy.KEEP, request)
        }

        fun cancel(context: Context, documentId: String) {
            WorkManager.getInstance(context.applicationContext)
                .cancelUniqueWork(workName(documentId))
        }
    }
}
