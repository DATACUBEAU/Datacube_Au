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
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.ExistingWorkPolicy
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
                    val manager = applicationContext.getSystemService(NotificationManager::class.java) ?: return Result.retry()
                    if (!manager.areNotificationsEnabled()) return Result.success()
                    manager.createNotificationChannel(
                        NotificationChannel(
                            CHANNEL, "AU update alerts", NotificationManager.IMPORTANCE_HIGH
                        )
                    )
                    if (manager.getNotificationChannel(CHANNEL)?.importance == NotificationManager.IMPORTANCE_NONE) return Result.success()
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
        private const val CHANNEL = "datacube_app_update_alerts_v2"
        private const val NOTIFICATION_ID = 76001
        private const val WORK_NAME = "datacube-android-update-check"

        fun schedule(context: Context) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()
            val request = PeriodicWorkRequestBuilder<AndroidUpdateCheckWorker>(
                12, TimeUnit.HOURS
            ).setConstraints(constraints).build()
            val work = WorkManager.getInstance(context.applicationContext)
            work.enqueueUniquePeriodicWork(
                    WORK_NAME, ExistingPeriodicWorkPolicy.UPDATE, request
                )
            // Refresh on launch, throttled to avoid repeated network traffic.
            val prefs = context.getSharedPreferences("datacube_updates", Context.MODE_PRIVATE)
            val now = System.currentTimeMillis()
            if (now - prefs.getLong("last_launch_check", 0L) >= TimeUnit.MINUTES.toMillis(30)) {
                val immediate = OneTimeWorkRequestBuilder<AndroidUpdateCheckWorker>()
                    .setConstraints(constraints).build()
                work.enqueueUniqueWork("datacube-launch-update-check", ExistingWorkPolicy.KEEP, immediate)
                prefs.edit().putLong("last_launch_check", now).apply()
            }
        }
    }
}
