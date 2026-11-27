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

    /** Explicit chat intent can prefill the same parser used by the manual editor. */
    fun proposedTime(message: String, now: java.time.ZonedDateTime = java.time.ZonedDateTime.now()): Long? =
        if (matches(message)) parseTime(message, now) else null

    fun parseTime(message: String, now: java.time.ZonedDateTime = java.time.ZonedDateTime.now()): Long? {
        val text = message.trim().lowercase(java.util.Locale.ROOT)
        if (text.isBlank() || text.length > 700) return null
        val words = mapOf("a" to 1L, "an" to 1L, "one" to 1L, "two" to 2L, "three" to 3L,
            "four" to 4L, "five" to 5L, "six" to 6L, "seven" to 7L, "eight" to 8L,
            "nine" to 9L, "ten" to 10L, "eleven" to 11L, "twelve" to 12L)
        val relative = Regex("""\b(?:in\s+|next\s+|after\s+)?(\d{1,4}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(minutes?|hours?|days?)\b""")
            .findAll(text).toList()
        if (relative.any { match ->
                val value = match.value
                val explicit = value.startsWith("in ") || value.startsWith("next ") || value.startsWith("after ")
                !explicit && value != text
            }) return null
        val bareNext = Regex("""\bnext\s+(minute|hour|day)\b""").findAll(text).toList()
        val dateTime = Regex("""\b(\d{4}-\d{2}-\d{2}|today|tomorrow)\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b""").findAll(text).toList()
        val clock = Regex("""^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$""").matchEntire(text)
        if (relative.size + bareNext.size + dateTime.size + (if (clock == null) 0 else 1) != 1) return null
        if (Regex("""\b(?:or|either|yesterday|last|ago|before)\b""").containsMatchIn(text)) return null
        return runCatching {
            val candidate = if (relative.isNotEmpty() || bareNext.isNotEmpty()) {
                val match = relative.firstOrNull()
                val amount = if (match == null) 1L else match.groupValues[1].toLongOrNull() ?: words[match.groupValues[1]] ?: return null
                val unit = match?.groupValues?.get(2) ?: bareNext.single().groupValues[1]
                if (amount <= 0L) return null
                when {
                    unit.startsWith("minute") -> now.plusMinutes(amount)
                    unit.startsWith("hour") -> now.plusHours(amount)
                    else -> now.plusDays(amount)
                }
            } else {
                val match = dateTime.firstOrNull() ?: clock ?: return null
                val explicitDay = dateTime.isNotEmpty()
                val dayToken = if (explicitDay) match.groupValues[1] else "today"
                val index = if (explicitDay) 2 else 1
                var hour = match.groupValues[index].toInt()
                val minute = match.groupValues[index + 1].toIntOrNull() ?: 0
                val suffix = match.groupValues[index + 2]
                if (minute !in 0..59) return null
                if (suffix.isNotEmpty()) {
                    if (hour !in 1..12) return null
                    hour = hour % 12 + if (suffix == "pm") 12 else 0
                } else {
                    if (hour !in 0..23 || match.groupValues[index + 1].isBlank()) return null
                }
                val day = when (dayToken) {
                    "today" -> now.toLocalDate()
                    "tomorrow" -> now.toLocalDate().plusDays(1)
                    else -> java.time.LocalDate.parse(dayToken)
                }
                val local = day.atTime(hour, minute)
                val offsets = now.zone.rules.getValidOffsets(local)
                if (offsets.size != 1) return null
                java.time.ZonedDateTime.ofStrict(local, offsets.single(), now.zone)
            }
            candidate.toInstant().toEpochMilli().takeIf { it > now.toInstant().toEpochMilli() }
        }.getOrNull()
    }
}
