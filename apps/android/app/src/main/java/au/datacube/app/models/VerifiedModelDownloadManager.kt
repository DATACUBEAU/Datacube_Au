package au.datacube.app.models

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.workDataOf
import java.util.UUID
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
        val alreadyInstalled = LocalModelLibrary(app).installed(id)
        check(ModelVaultStore(app).folder() != null) {
            "Choose your model folder before downloading."
        }
        preferences.edit().putBoolean("paused_$id", false).putBoolean("wifi_$id", wifiOnly).apply()
        work.enqueueUniqueWork(workName(id), ExistingWorkPolicy.KEEP,
            request(id, alreadyInstalled, wifiOnly).build())
    }

    private fun request(id: String, alreadyInstalled: Boolean, wifiOnly: Boolean) =
        OneTimeWorkRequestBuilder<VerifiedModelDownloadWorker>()
            .setInputData(workDataOf(VerifiedModelDownloadWorker.KEY_MODEL_ID to id))
            .setConstraints(downloadConstraints(alreadyInstalled, wifiOnly))
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30L, TimeUnit.SECONDS)
            .addTag("datacube-verified-model")

    /** Update the same queued request rather than cancelling or deleting its partial file.
     * Older installed builds persisted the battery constraint in WorkManager's database. */
    suspend fun updateQueued(id: String, workId: UUID, wifiOnly: Boolean? = null) = withContext(Dispatchers.IO) {
        requireNotNull(VerifiedModelDownloads.find(id))
        if (paused(id)) return@withContext
        val current = work.getWorkInfosForUniqueWork(workName(id)).get()
            .firstOrNull { it.id == workId && it.state == WorkInfo.State.ENQUEUED }
            ?: return@withContext
        val selected = wifiOnly ?: preferences.getBoolean("wifi_$id",
            current.constraints.requiredNetworkType == NetworkType.UNMETERED)
        if (wifiOnly == null && !current.constraints.requiresBatteryNotLow()) return@withContext
        val installed = LocalModelLibrary(app).installed(id)
        work.updateWork(request(id, installed, selected).setId(workId).build()).get()
        preferences.edit().putBoolean("wifi_$id", selected).apply()
    }

    fun queuedMessage(info: WorkInfo): String {
        if (info.state == WorkInfo.State.BLOCKED) return "Queued · waiting for earlier work"
        val connectivity = app.getSystemService(ConnectivityManager::class.java)
        val capabilities = connectivity?.getNetworkCapabilities(connectivity.activeNetwork)
        val connected = capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
        val unmetered = capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED) == true
        val battery = app.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level = battery?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = battery?.getIntExtra(BatteryManager.EXTRA_SCALE, 100) ?: 100
        val percent = if (level >= 0 && scale > 0) level * 100 / scale else -1
        val storageLow = app.registerReceiver(null, IntentFilter(Intent.ACTION_DEVICE_STORAGE_LOW)) != null
        return queueMessage(info.constraints.requiredNetworkType, connected, unmetered,
            info.constraints.requiresBatteryNotLow() && percent in 0..15, storageLow, info.runAttemptCount)
    }

    fun resume(id: String) = start(id, wifiOnly = preferences.getBoolean("wifi_$id", true))

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
        internal fun downloadConstraints(alreadyInstalled: Boolean, wifiOnly: Boolean): Constraints =
            Constraints.Builder()
                .setRequiredNetworkType(if (alreadyInstalled) NetworkType.NOT_REQUIRED
                    else if (wifiOnly) NetworkType.UNMETERED else NetworkType.CONNECTED)
                .setRequiresStorageNotLow(true)
                // This work follows an explicit user tap, not automatic background maintenance.
                .setRequiresBatteryNotLow(false)
                .build()

        internal fun queueMessage(network: NetworkType, connected: Boolean, unmetered: Boolean,
            batteryRestricted: Boolean, storageLow: Boolean, attempts: Int): String = when {
            storageLow -> "Queued · device storage is low"
            batteryRestricted -> "Queued · previous battery restriction (updating)"
            network != NetworkType.NOT_REQUIRED && !connected -> "Queued · waiting for internet"
            network == NetworkType.UNMETERED && !unmetered -> "Queued · waiting for Wi-Fi or unmetered connection"
            attempts > 0 -> "Queued · retrying after an interruption"
            else -> "Queued · waiting for Android to start the task"
        }

        fun workName(id: String): String {
            requireNotNull(VerifiedModelDownloads.find(id))
            return "datacube-model-download-$id"
        }
    }
}
