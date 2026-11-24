package au.datacube.app.models

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.ForegroundInfo
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow

/** A foreground user-initiated ZIP export that survives leaving the app. */
class ModelVaultBackupWorker(
    context: Context,
    parameters: WorkerParameters
) : CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result {
        val modelId = inputData.getString(KEY_MODEL).orEmpty()
        if (ModelCatalog.models.none { it.id == modelId }) {
            return Result.failure(workDataOf(KEY_ERROR to "Unknown model."))
        }
        return try {
            val manager = applicationContext.getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL, "Model backups", NotificationManager.IMPORTANCE_LOW)
            )
            val notification = Notification.Builder(applicationContext, CHANNEL)
                .setSmallIcon(android.R.drawable.stat_sys_upload)
                .setContentTitle("Backing up $modelId")
                .setContentText("Saving verified model files to your folder")
                .setProgress(0, 0, true)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .build()
            val info = if (Build.VERSION.SDK_INT >= 29) {
                ForegroundInfo(NOTIFICATION_ID + (modelId.hashCode() and 0x0fff),
                    notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
            } else ForegroundInfo(NOTIFICATION_ID + (modelId.hashCode() and 0x0fff), notification)
            setForeground(info)
            setProgress(workDataOf(KEY_STAGE to "Checking model files"))
            var stage = "Writing model archive"
            val summary = ModelVaultStore(applicationContext).save(
                modelId = modelId,
                onProgress = { written, total ->
                    setProgress(workDataOf(
                        KEY_STAGE to stage,
                        KEY_WRITTEN to written,
                        KEY_TOTAL to total
                    ))
                },
                onStage = { next ->
                    stage = next
                    setProgress(workDataOf(KEY_STAGE to next))
                }
            )
            Result.success(workDataOf(
                KEY_STAGE to "Backed up",
                KEY_FILES to summary.fileCount,
                KEY_WRITTEN to summary.totalBytes,
                KEY_TOTAL to summary.totalBytes
            ))
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: Exception) {
            Result.failure(workDataOf(KEY_ERROR to (error.message ?: "Backup failed.")))
        }
    }

    companion object {
        const val KEY_MODEL = "modelId"
        const val KEY_STAGE = "stage"
        const val KEY_FILES = "files"
        const val KEY_WRITTEN = "writtenBytes"
        const val KEY_TOTAL = "totalBytes"
        const val KEY_ERROR = "error"
        private const val CHANNEL = "datacube_model_backups"
        private const val NOTIFICATION_ID = 61000
    }
}

/** Each model has at most one active vault backup job. */
class ModelVaultBackupJobs(context: Context) {
    private val app = context.applicationContext
    private val work = WorkManager.getInstance(app)

    fun start(modelId: String) {
        require(ModelCatalog.models.any { it.id == modelId }) { "Unknown model type." }
        check(ModelVaultStore(app).folder() != null) { "Choose your model folder first." }
        check(LocalModelLibrary(app).installed(modelId)) { "Install the model before saving a backup." }
        val request = OneTimeWorkRequestBuilder<ModelVaultBackupWorker>()
            .setInputData(workDataOf(ModelVaultBackupWorker.KEY_MODEL to modelId))
            .build()
        work.enqueueUniqueWork(name(modelId), ExistingWorkPolicy.KEEP, request)
    }

    fun observe(modelId: String): Flow<List<WorkInfo>> =
        work.getWorkInfosForUniqueWorkFlow(name(modelId))

    fun cancel(modelId: String) { work.cancelUniqueWork(name(modelId)) }

    private fun name(id: String) = "datacube-model-vault-$id"
}
