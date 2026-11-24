package au.datacube.app.updates

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import au.datacube.app.MainActivity
import au.datacube.app.R
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CancellationException

/** Metadata-only checks; actual APK downloads require the user's Update tap. */
class AndroidUpdateCheckWorker(
    context: Context,
    parameters: WorkerParameters
) : CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result {
        return try {
            val available = AndroidUpdateManager.check(applicationContext)
            if (available != null && canNotify()) {
                val settings = applicationContext.getSharedPreferences(
                    "datacube_updates", Context.MODE_PRIVATE
                )
                val shown = settings.getInt("last_notified_version", 0)
                if (available.versionCode > shown) {
                    val manager = applicationContext.getSystemService(NotificationManager::class.java)
                    manager.createNotificationChannel(
                        NotificationChannel(
                            CHANNEL, "App updates", NotificationManager.IMPORTANCE_LOW
                        )
                    )
                    val open = Intent(applicationContext, MainActivity::class.java)
                        .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                    val tap = PendingIntent.getActivity(
                        applicationContext, 75, open,
                        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                    )
                    manager.notify(
                        NOTIFICATION_ID,
                        Notification.Builder(applicationContext, CHANNEL)
                            .setSmallIcon(R.drawable.ic_notification_datacube)
                            .setContentTitle("DataCube AU update available")
                            .setContentText("Open Settings → App updates to install ${available.versionName}.")
                            .setContentIntent(tap)
                            .setAutoCancel(true)
                            .setOnlyAlertOnce(true)
                            .setShowWhen(false)
                            .setVisibility(Notification.VISIBILITY_PRIVATE)
                            .build()
                    )
                    settings.edit().putInt("last_notified_version", available.versionCode).apply()
                }
            }
            Result.success()
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            // A transient offline website is not an application failure.
            Result.retry()
        }
    }

    private fun canNotify(): Boolean =
        Build.VERSION.SDK_INT < 33 ||
            applicationContext.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED

    companion object {
        private const val CHANNEL = "datacube_app_updates"
        private const val NOTIFICATION_ID = 76001
        private const val WORK_NAME = "datacube-android-update-check"

        fun schedule(context: Context) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()
            val request = PeriodicWorkRequestBuilder<AndroidUpdateCheckWorker>(
                12, TimeUnit.HOURS
            ).setConstraints(constraints).build()
            WorkManager.getInstance(context.applicationContext)
                .enqueueUniquePeriodicWork(
                    WORK_NAME, ExistingPeriodicWorkPolicy.KEEP, request
                )
        }
    }
}
