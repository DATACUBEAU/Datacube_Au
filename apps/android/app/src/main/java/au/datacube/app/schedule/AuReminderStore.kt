package au.datacube.app.schedule

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.work.*
import au.datacube.app.MainActivity
import au.datacube.app.R
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.TimeUnit

data class AuReminder(val id: String, val account: String, val workspace: String?, val title: String,
    val at: Long, val state: String = "Scheduled")

class AuReminderStore(context: Context) {
    private val app = context.applicationContext
    private val prefs = app.getSharedPreferences("au_study_reminders", Context.MODE_PRIVATE)
    private val work get() = WorkManager.getInstance(app)

    fun list(account: String, workspace: String? = null): List<AuReminder> =
        synchronized(lock) {
            prefs.all.keys.mapNotNull { read(it) }
                .filter { it.account == account && (workspace == null || it.workspace == workspace) }
                .sortedBy { it.at }
        }
    internal fun read(id: String): AuReminder? = runCatching {
        val json = JSONObject(prefs.getString(id, null) ?: return null)
        AuReminder(id, json.getString("account"), json.optString("workspace").ifBlank { null },
            json.getString("title"), json.getLong("at"), json.optString("state", "Scheduled"))
    }.getOrNull()

    private fun write(item: AuReminder) {
        check(prefs.edit().putString(item.id, JSONObject().put("account", item.account)
            .put("workspace", item.workspace.orEmpty()).put("title", item.title)
            .put("at", item.at).put("state", item.state).toString()).commit()) { "Could not save reminder." }
    }

    suspend fun add(account: String, workspace: String?, title: String, at: Long): AuReminder =
        withContext(Dispatchers.IO) {
            require(account.isNotBlank() && title.isNotBlank() && title.length <= 240)
            require(at > System.currentTimeMillis()) { "Choose a future date and time." }
            val item = AuReminder(UUID.randomUUID().toString(), account, workspace, title.trim(), at)
            synchronized(lock) {
                require(list(account).count { it.state == "Scheduled" } < 100) { "Too many active reminders." }
                write(item)
            }
            try {
                val request = OneTimeWorkRequestBuilder<AuReminderWorker>()
                    .setInitialDelay((at - System.currentTimeMillis()).coerceAtLeast(0), TimeUnit.MILLISECONDS)
                    .setInputData(workDataOf("id" to item.id)).build()
                work.enqueueUniqueWork("au-reminder-" + item.id, ExistingWorkPolicy.KEEP, request).result.get()
                item
            } catch (e: Exception) {
                synchronized(lock) { prefs.edit().remove(item.id).commit() }
                throw e
            }
        }

    suspend fun cancel(account: String, id: String) = withContext(Dispatchers.IO) {
        synchronized(lock) {
            val item = read(id)
            if (item?.account != account) return@withContext
            check(prefs.edit().remove(id).commit()) { "Could not remove reminder." }
        }
        work.cancelUniqueWork("au-reminder-" + id).result.get()
        app.getSystemService(NotificationManager::class.java)?.cancel("au-reminder-" + id, 1)
    }

    internal fun deliver(id: String) = synchronized(lock) {
        val item = read(id) ?: return@synchronized
        if (item.state != "Scheduled") return@synchronized
        val manager = app.getSystemService(NotificationManager::class.java)
        val allowed = manager != null && manager.areNotificationsEnabled() &&
            (Build.VERSION.SDK_INT < 33 || app.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)
        if (!allowed || manager == null) {
            write(item.copy(state = "Notifications disabled"))
            return@synchronized
        }
        manager.createNotificationChannel(NotificationChannel(CHANNEL, "AU study reminders", NotificationManager.IMPORTANCE_HIGH)
            .apply { description = "Scheduled study reminders and alerts" })
        if (manager.getNotificationChannel(CHANNEL)?.importance == NotificationManager.IMPORTANCE_NONE) {
            write(item.copy(state = "Notifications disabled"))
            return@synchronized
        }
        val open = PendingIntent.getActivity(app, 0, Intent(app, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val publicNotice = Notification.Builder(app, CHANNEL).setSmallIcon(R.drawable.ic_notification_datacube)
            .setContentTitle("AU study reminder").setContentText("Open AU to view your reminder.").build()
        manager.notify("au-reminder-" + id, 1, Notification.Builder(app, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification_datacube).setContentTitle("AU study reminder")
            .setContentText("It's time for your scheduled study task.").setContentIntent(open)
            .setVisibility(Notification.VISIBILITY_PRIVATE).setPublicVersion(publicNotice)
            .setCategory(Notification.CATEGORY_REMINDER).setAutoCancel(true).build())
        write(item.copy(state = "Reminder delivered"))
    }

    companion object {
        const val CHANNEL = "au_study_reminders"
        private val lock = Any()
    }
}

class AuReminderWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val id = inputData.getString("id") ?: return@withContext Result.failure()
        try {
            AuReminderStore(applicationContext).deliver(id)
            Result.success()
        } catch (e: Exception) {
            if (runAttemptCount < 2) Result.retry() else Result.failure()
        }
    }
}

/** Explicit reminder requests only. A model answer never executes a scheduling action. */
object AuScheduleIntent {
    private val request = Regex("^(?:au[, ]+)?(?:(?:can|could|would) you\\s+)?(?:please\\s+)?(?:remind me|set (?:a |an )?reminder|schedule (?:a |an )?(?:study session|reminder|task))\\b", RegexOption.IGNORE_CASE)
    fun matches(message: String): Boolean = request.containsMatchIn(message.trim())

    /** Conservative English parser. Ambiguous or past dates require a manual choice. */
    fun proposedTime(message: String, now: java.time.ZonedDateTime = java.time.ZonedDateTime.now()): Long? {
        if (!matches(message)) return null
        val relative = Regex("\\bin\\s+(\\d{1,4})\\s+(minutes?|hours?|days?)\\b", RegexOption.IGNORE_CASE).findAll(message).toList()
        val clock = Regex("\\b(today|tomorrow)\\s+at\\s+(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)\\b", RegexOption.IGNORE_CASE).findAll(message).toList()
        if (relative.size + clock.size != 1) return null
        val candidate = if (relative.isNotEmpty()) {
            val match = relative.single()
            val amount = match.groupValues[1].toLong()
            if (amount <= 0) return null
            when {
                match.groupValues[2].startsWith("minute", true) -> now.plusMinutes(amount)
                match.groupValues[2].startsWith("hour", true) -> now.plusHours(amount)
                else -> now.plusDays(amount)
            }
        } else {
            val match = clock.single()
            val hour = match.groupValues[2].toInt()
            val minute = match.groupValues[3].toIntOrNull() ?: 0
            if (hour !in 1..12 || minute !in 0..59) return null
            val day = now.toLocalDate().plusDays(if (match.groupValues[1].equals("tomorrow", true)) 1 else 0)
            val hour24 = hour % 12 + if (match.groupValues[4].equals("pm", true)) 12 else 0
            val local = day.atTime(hour24, minute)
            val offsets = now.zone.rules.getValidOffsets(local)
            if (offsets.size != 1) return null
            java.time.ZonedDateTime.ofStrict(local, offsets.single(), now.zone)
        }
        return candidate.toInstant().toEpochMilli().takeIf { it > now.toInstant().toEpochMilli() }
    }
}
