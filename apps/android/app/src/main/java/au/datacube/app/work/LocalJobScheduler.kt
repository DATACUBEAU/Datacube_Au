package au.datacube.app.work

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.ListenableWorker
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequest
import androidx.work.WorkManager
import androidx.work.workDataOf
import au.datacube.app.data.DataCubeDatabase
import au.datacube.app.data.LocalJob
import au.datacube.app.data.LocalJobKind
import au.datacube.app.data.LocalJobStatus
import java.util.concurrent.TimeUnit
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
        val request = OneTimeWorkRequest.Builder(workerClass)
            .setInputData(workDataOf(DocumentIntegrityWorker.KEY_JOB_ID to jobId))
            .setConstraints(
                Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.NOT_REQUIRED)
                    .setRequiresBatteryNotLow(true)
                    .build()
            )
            .setBackoffCriteria(
                BackoffPolicy.EXPONENTIAL,
                30,
                TimeUnit.SECONDS
            )
            .build()

        workManager.enqueueUniqueWork(
            UNIQUE_WORK_PREFIX + jobId,
            ExistingWorkPolicy.KEEP,
            request
        )
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
            enqueue(job.id, job.kind)
        }
    }

    companion object {
        private const val UNIQUE_WORK_PREFIX = "datacube-local-job-"
    }
}
