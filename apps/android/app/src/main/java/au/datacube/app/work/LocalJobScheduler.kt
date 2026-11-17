package au.datacube.app.work

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.workDataOf
import au.datacube.app.data.DataCubeDatabase
import java.util.concurrent.TimeUnit

class LocalJobScheduler(context: Context) {
    private val appContext = context.applicationContext
    private val database = DataCubeDatabase.get(appContext)
    private val workManager = WorkManager.getInstance(appContext)

    fun enqueue(jobId: String) {
        require(jobId.isNotBlank()) { "A durable job ID is required." }
        val request = OneTimeWorkRequestBuilder<DocumentIntegrityWorker>()
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
        database.jobs().findRecoverable().forEach { job ->
            enqueue(job.id)
        }
    }

    companion object {
        private const val UNIQUE_WORK_PREFIX = "datacube-local-job-"
    }
}
