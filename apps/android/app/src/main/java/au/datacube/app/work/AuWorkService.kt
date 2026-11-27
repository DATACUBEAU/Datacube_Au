package au.datacube.app.work

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import au.datacube.app.notifications.TaskDestination
import au.datacube.app.R
import kotlinx.coroutines.Job
import java.util.concurrent.ConcurrentHashMap

/** Protect explicitly requested local work while Android backgrounds the activity.
 * Jobs remain process-owned; process death is not a resumable inference checkpoint.
 */
object AuBackgroundWork {
    internal data class Task(val label: String, val destination: String?, val started: Long)
    private val jobs = ConcurrentHashMap<Job, Task>()
    fun track(context: Context, job: Job, label: String, destination: String? = null) {
        if (!job.isActive) return
        jobs[job] = Task(label, destination, android.os.SystemClock.elapsedRealtime())
        job.invokeOnCompletion { jobs.remove(job) }
        try {
            context.applicationContext.startForegroundService(Intent(context, AuWorkService::class.java))
        } catch (failure: Exception) {
            Log.w("AuBackgroundWork", "Foreground protection unavailable", failure)
        }
    }
    internal fun labels(): List<Task> = jobs.values.sortedByDescending { it.started }
    fun cancelAll() { jobs.keys.toList().forEach { it.cancel() } }
}

class AuWorkService : Service() {
    private val handler = Handler(Looper.getMainLooper())
    private val manager get() = requireNotNull(getSystemService(NotificationManager::class.java))
    private var lastLabels: List<AuBackgroundWork.Task>? = null
    private val refresh = object : Runnable {
        override fun run() {
            val labels = AuBackgroundWork.labels()
            if (labels.isEmpty()) {
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
                return
            }
            if (lastLabels != labels) {
                manager.notify(ID, notification(labels))
                lastLabels = labels
            }
            handler.postDelayed(this, 2000)
        }
    }
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        manager.createNotificationChannel(NotificationChannel(CHANNEL, "Active AU tasks", NotificationManager.IMPORTANCE_LOW))
        lastLabels = AuBackgroundWork.labels()
        val notification = notification(lastLabels.orEmpty())
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else startForeground(ID, notification)
        if (intent?.action == STOP) AuBackgroundWork.cancelAll()
        handler.removeCallbacks(refresh)
        handler.post(refresh)
        return START_NOT_STICKY
    }
    private fun notification(labels: List<AuBackgroundWork.Task>): Notification {
        val open = TaskDestination.pending(this, labels.firstOrNull()?.destination, "active-task")
        val stop = PendingIntent.getService(this, 72, Intent(this, AuWorkService::class.java).setAction(STOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        return Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification_datacube)
            .setContentTitle("AU is working")
            .setContentText(if (labels.size == 1) labels.first().label else if (labels.isEmpty()) "Finishing" else "${labels.size} active tasks")
            .setContentIntent(open).setOngoing(true).setOnlyAlertOnce(true)
            .setVisibility(Notification.VISIBILITY_PRIVATE).setProgress(0, 0, true)
            .addAction(Notification.Action.Builder(null, "Stop tasks", stop).build()).build()
    }
    override fun onDestroy() {
        handler.removeCallbacks(refresh)
        super.onDestroy()
    }
    companion object {
        private const val CHANNEL = "au_active_tasks"
        private const val ID = 27104
        private const val STOP = "au.datacube.STOP_LOCAL_TASKS"
    }
}
