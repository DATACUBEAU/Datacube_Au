package au.datacube.app.work

import android.content.Context
import androidx.work.ExistingWorkPolicy
import androidx.work.ListenableWorker
import au.datacube.app.data.rag.LexicalIndexWorker
import au.datacube.app.data.rag.LocalSemanticSearch
import kotlinx.coroutines.flow.first
import androidx.work.WorkManager
import androidx.work.workDataOf
import au.datacube.app.data.DataCubeDatabase
import au.datacube.app.data.LocalJob
import au.datacube.app.data.LocalJobKind
import au.datacube.app.data.LocalJobStatus
import org.json.JSONObject

class LocalJobScheduler(context: Context) {
    private val appContext = context.applicationContext
    private val database = DataCubeDatabase.get(appContext)
    private val workManager = WorkManager.getInstance(appContext)

    fun enqueue(jobId: String, kind: String) {
        require(jobId.isNotBlank()) { "A durable job ID is required." }
        val workerClass: Class<out ListenableWorker> = when (kind) {
            LocalJobKind.DOCUMENT_INTEGRITY_CHECK -> DocumentIntegrityWorker::class.java
            LocalJobKind.DOCUMENT_TEXT_EXTRACTION -> DocumentTextExtractionWorker::class.java
            else -> return
        }
        val request = DocumentWorkPolicy.request(workerClass,
            workDataOf(DocumentIntegrityWorker.KEY_JOB_ID to jobId))

        workManager.enqueueUniqueWork(
            UNIQUE_WORK_PREFIX + jobId,
            ExistingWorkPolicy.KEEP,
            request
        )
    }

    fun cancel(jobId: String) {
        workManager.cancelUniqueWork(UNIQUE_WORK_PREFIX + jobId)
    }

    suspend fun enqueueRecoverable() {
        database.documents().findTextDocumentsMissingExtraction().forEach { document ->
            val now = System.currentTimeMillis()
            database.jobs().insertIfAbsent(
                LocalJob(
                    id = "text-extract-${document.id}",
                    kind = LocalJobKind.DOCUMENT_TEXT_EXTRACTION,
                    status = LocalJobStatus.QUEUED,
                    payloadJson = JSONObject().put("documentId", document.id).toString(),
                    progress = 0.0,
                    attempts = 0,
                    createdAtEpochMs = now,
                    updatedAtEpochMs = now
                )
            )
        }

        database.jobs().findRecoverable().forEach { job ->
            val workerClass: Class<out ListenableWorker> = when (job.kind) {
                LocalJobKind.DOCUMENT_INTEGRITY_CHECK -> DocumentIntegrityWorker::class.java
                LocalJobKind.DOCUMENT_TEXT_EXTRACTION -> DocumentTextExtractionWorker::class.java
                else -> return@forEach
            }
            DocumentWorkPolicy.updateLegacy(workManager, UNIQUE_WORK_PREFIX + job.id, workerClass,
                workDataOf(DocumentIntegrityWorker.KEY_JOB_ID to job.id))
            enqueue(job.id, job.kind)
        }
        // Update persisted indexing requests too, including documents that already
        // finished extraction. No new indexing jobs or duplicate downloads are created.
        if (DocumentWorkPolicy.hasLegacyIndexWork(workManager)) {
            database.documents().observeAll().first().forEach { document ->
                LexicalIndexWorker.updateLegacyRequest(appContext, document.id)
                LocalSemanticSearch(appContext).updateLegacyRequest(document.id)
            }
        }
    }

    companion object {
        private const val UNIQUE_WORK_PREFIX = "datacube-local-job-"
    }
}
