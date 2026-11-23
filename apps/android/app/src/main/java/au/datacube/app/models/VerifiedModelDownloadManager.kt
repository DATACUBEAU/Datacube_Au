package au.datacube.app.models

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.workDataOf
import java.io.File
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.withContext

/** User-driven; no background auto-download during login. */
class VerifiedModelDownloadManager(context: Context) {
    private val app = context.applicationContext
    private val work = WorkManager.getInstance(app)
    private val preferences = app.getSharedPreferences("datacube_model_downloads", Context.MODE_PRIVATE)

    fun observe(id: String): Flow<List<WorkInfo>> =
        work.getWorkInfosForUniqueWorkFlow(workName(id))

    fun paused(id: String): Boolean = preferences.getBoolean("paused_$id", false)

    fun start(id: String, wifiOnly: Boolean) {
        requireNotNull(VerifiedModelDownloads.find(id)) { "No verified download for this model." }
        require(!LocalModelLibrary(app).installed(id)) { "Model files already exist." }
        preferences.edit().putBoolean("paused_$id", false).apply()
        val request = OneTimeWorkRequestBuilder<VerifiedModelDownloadWorker>()
            .setInputData(workDataOf(
                VerifiedModelDownloadWorker.KEY_MODEL_ID to id
            ))
            .setConstraints(
                Constraints.Builder()
                    .setRequiredNetworkType(if (wifiOnly) NetworkType.UNMETERED else NetworkType.CONNECTED)
                    .setRequiresStorageNotLow(true)
                    .setRequiresBatteryNotLow(true)
                    .build()
            )
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30L, TimeUnit.SECONDS)
            .addTag("datacube-verified-model")
            .build()
        work.enqueueUniqueWork(workName(id), ExistingWorkPolicy.REPLACE, request)
    }

    suspend fun pause(id: String) = withContext(Dispatchers.IO) {
        preferences.edit().putBoolean("paused_$id", true).commit()
        work.cancelUniqueWork(workName(id)).result.get()
    }

    suspend fun cancel(id: String) = withContext(Dispatchers.IO) {
        preferences.edit().putBoolean("paused_$id", false).commit()
        work.cancelUniqueWork(workName(id)).result.get()
        VerifiedModelDownloadWorker.partialFile(app, id).delete()
        VerifiedModelDownloadWorker.etagFile(app, id).delete()
    }

    companion object {
        fun workName(id: String): String {
            requireNotNull(VerifiedModelDownloads.find(id))
            return "datacube-model-download-$id"
        }
    }
}
