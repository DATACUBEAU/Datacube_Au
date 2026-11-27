package au.datacube.app.work

import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.Data
import androidx.work.ListenableWorker
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequest
import androidx.work.WorkInfo
import androidx.work.WorkManager
import au.datacube.app.data.rag.LexicalIndexWorker
import au.datacube.app.data.rag.SemanticIndexWorker
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** User-initiated document processing can proceed offline and at low charge.
 * OS power/thermal rules still apply; retain storage protection and retry backoff. */
internal object DocumentWorkPolicy {
    fun constraints(): Constraints = Constraints.Builder()
        .setRequiredNetworkType(NetworkType.NOT_REQUIRED)
        .setRequiresBatteryNotLow(false)
        .setRequiresStorageNotLow(true)
        .build()

    fun request(workerClass: Class<out ListenableWorker>, input: Data,
        existingId: UUID? = null): OneTimeWorkRequest {
        val builder = OneTimeWorkRequest.Builder(workerClass)
            .setInputData(input)
            .setConstraints(constraints())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30L, TimeUnit.SECONDS)
        if (existingId != null) builder.setId(existingId)
        return builder.build()
    }

    private fun legacy(info: WorkInfo): Boolean =
        !info.state.isFinished && info.constraints.requiresBatteryNotLow()

    suspend fun hasLegacyIndexWork(work: WorkManager): Boolean = withContext(Dispatchers.IO) {
        listOf(LexicalIndexWorker::class.java.name, SemanticIndexWorker::class.java.name).any { tag ->
            work.getWorkInfosByTag(tag).get().any(::legacy)
        }
    }

    /** Update the existing WorkManager ID. Never replace, cancel, or restart completed work. */
    suspend fun updateLegacy(work: WorkManager, uniqueName: String,
        workerClass: Class<out ListenableWorker>, input: Data) = withContext(Dispatchers.IO) {
        work.getWorkInfosForUniqueWork(uniqueName).get().filter(::legacy).forEach { existing ->
            work.updateWork(request(workerClass, input, existing.id)).get()
        }
    }
}
