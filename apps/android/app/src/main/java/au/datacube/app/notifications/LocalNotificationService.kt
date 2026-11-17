package au.datacube.app.notifications

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context

class LocalNotificationService(private val context: Context) {
    fun showDocumentCheckComplete(jobId: String) {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Background processing",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Generic status updates for local DataCube tasks."
        }
        manager.createNotificationChannel(channel)

        // Do not request permission from a background worker. The app will ask
        // at an intentional onboarding/settings point in a later UI slice.
        if (!manager.areNotificationsEnabled()) return

        val notification = Notification.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentTitle("DataCube AU")
            .setContentText("A local document check is complete.")
            .setOnlyAlertOnce(true)
            .setAutoCancel(true)
            .build()
        manager.notify(jobId.hashCode() and Int.MAX_VALUE, notification)
    }

    companion object {
        private const val CHANNEL_ID = "datacube_local_processing"
    }
}
