package au.datacube.app.data.rag

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import au.datacube.app.work.DocumentWorkPolicy
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import au.datacube.app.data.DataCubeDatabase
import au.datacube.app.data.ExtractedTextStore
import au.datacube.app.notifications.LocalNotificationService
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
            val foreground = notifications.startDocumentWorker(this@LexicalIndexWorker, "Preparing document search")
            notifications.updateDocumentWorker(this@LexicalIndexWorker, documentId, foreground, "Preparing document search")
            val count = index.build(documentId, file) { completed ->
                // Schedule WorkManager persistence without suspending SQLite's
                // thread-bound indexing transaction.
                setProgressAsync(workDataOf(KEY_COUNT to completed))
                notifications.updateDocumentWorker(this@LexicalIndexWorker, documentId, foreground, "Indexed $completed passages")
            }
            // A deleted document must never publish a new ready notification.
            if (db.documents().find(documentId) != null) {
                notifications.showIndexComplete(documentId)
                // Optional embedding index is scheduled automatically, without opening chat.
                LocalSemanticSearch(applicationContext).scheduleIndex(documentId)
            } else {
                index.remove(documentId)
            }
            Result.success(workDataOf(KEY_COUNT to count))
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: Exception) {
            if (db.documents().find(documentId) != null) notifications.showDocumentFailed(documentId)
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
            val request = DocumentWorkPolicy.request(LexicalIndexWorker::class.java,
                workDataOf(KEY_DOCUMENT to documentId))
            WorkManager.getInstance(context.applicationContext)
                .enqueueUniqueWork(workName(documentId), ExistingWorkPolicy.KEEP, request)
        }

        internal suspend fun updateLegacyRequest(context: Context, documentId: String) {
            if (!documentId.matches(Regex("[A-Za-z0-9_-]{1,80}"))) return
            DocumentWorkPolicy.updateLegacy(WorkManager.getInstance(context.applicationContext),
                workName(documentId), LexicalIndexWorker::class.java, workDataOf(KEY_DOCUMENT to documentId))
        }

        fun cancel(context: Context, documentId: String) {
            WorkManager.getInstance(context.applicationContext)
                .cancelUniqueWork(workName(documentId))
        }
    }
}
