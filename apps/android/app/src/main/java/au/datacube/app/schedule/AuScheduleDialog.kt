package au.datacube.app.schedule

import android.Manifest
import android.app.NotificationManager
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.CalendarContract
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import au.datacube.app.ui.common.DataCubeDialog
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.util.Date

@Composable
fun AuScheduleDialog(account: String, workspace: String? = null, initialTitle: String = "",
    onDismiss: () -> Unit) {
    val context = LocalContext.current
    val store = remember(context) { AuReminderStore(context) }
    val scope = rememberCoroutineScope()
    var title by remember(initialTitle) { mutableStateOf(initialTitle.take(240)) }
    val proposed = remember(initialTitle) { AuScheduleIntent.proposedTime(initialTitle) }
    var timeText by remember(initialTitle) { mutableStateOf(if (proposed != null) initialTitle else "") }
    val referenceNow = remember(timeText) { java.time.ZonedDateTime.now() }
    val at = remember(timeText, referenceNow) {
        AuScheduleIntent.parseTime(timeText, referenceNow)
    }
    var tasks by remember { mutableStateOf(store.list(account, workspace)) }
    var status by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        status = if (granted) "Notifications enabled. Save your reminder." else "Notifications are off. Enable them in Android settings."
    }
    fun format(value: Long) = DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(value))
    fun enabled(): Boolean {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return false
        return manager.areNotificationsEnabled() &&
            (Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) &&
            manager.getNotificationChannel(AuReminderStore.CHANNEL)?.importance != NotificationManager.IMPORTANCE_NONE
    }
    val valid = title.isNotBlank() && at != null && at > System.currentTimeMillis() && !busy
    DataCubeDialog(onDismissRequest = { if (!busy) onDismiss() }, title = { Text("Schedules") },
        text = {
            Column(Modifier.heightIn(max = 500.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(title, { title = it.take(240) }, label = { Text("Study task") },
                    modifier = Modifier.fillMaxWidth(), maxLines = 3)
                OutlinedTextField(timeText, { timeText = it.take(240) },
                    label = { Text("When?") }, placeholder = { Text("Tomorrow at 7 PM") },
                    supportingText = { Text("Try next five hours, 18:30, or YYYY-MM-DD 09:00.") },
                    modifier = Modifier.fillMaxWidth(), maxLines = 2, enabled = !busy)
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf("In 1 hour", "In 5 hours", "Tomorrow at 9 AM").forEachIndexed { n, value ->
                        FilterChip(selected = timeText.equals(value, true), onClick = { timeText = value },
                            label = { Text(listOf("1h", "5h", "Tomorrow")[n]) }, enabled = !busy)
                    }
                }
                if (at != null) {
                    Surface(color = MaterialTheme.colorScheme.primaryContainer,
                        shape = androidx.compose.foundation.shape.RoundedCornerShape(16.dp)) {
                        Column(Modifier.fillMaxWidth().padding(12.dp)) {
                            Text("AU understood", style = MaterialTheme.typography.labelMedium)
                            Text(format(at), style = MaterialTheme.typography.titleMedium)
                            Text("Local device time · Review before saving.", style = MaterialTheme.typography.bodySmall)
                        }
                    }
                } else if (timeText.isNotBlank()) Text("Enter a clear future date and time. AU will not guess ambiguous times.",
                    color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                Text("Reminders work offline. Android may delay delivery to save battery.", style = MaterialTheme.typography.bodySmall)
                Button(enabled = valid, onClick = {
                    val selectedAt = at ?: return@Button
                    if (selectedAt <= System.currentTimeMillis()) { status = "Choose a future time."; return@Button }
                    if (!enabled()) {
                        if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                            permission.launch(Manifest.permission.POST_NOTIFICATIONS)
                        } else {
                            status = "Enable AU notifications and try again."
                            runCatching { context.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                                .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)) }
                        }
                    } else {
                        busy = true
                        scope.launch {
                            try {
                                store.add(account, workspace, title, selectedAt)
                                tasks = store.list(account, workspace)
                                title = ""
                                timeText = ""
                                status = "Reminder saved."
                            } catch (e: Exception) {
                                status = e.message ?: "Could not schedule reminder."
                            } finally { busy = false }
                        }
                    }
                }, modifier = Modifier.fillMaxWidth()) { Text("Schedule AU reminder") }
                OutlinedButton(enabled = valid, onClick = {
                    val selectedAt = at ?: return@OutlinedButton
                    if (selectedAt <= System.currentTimeMillis()) { status = "Choose a future time."; return@OutlinedButton }
                    try {
                        context.startActivity(Intent(Intent.ACTION_INSERT, CalendarContract.Events.CONTENT_URI)
                            .putExtra(CalendarContract.Events.TITLE, title.trim())
                            .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, selectedAt)
                            .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, selectedAt + 30 * 60 * 1000L))
                        status = "Save the event in your calendar to confirm."
                    } catch (_: Exception) { status = "No calendar app available." }
                }, modifier = Modifier.fillMaxWidth()) { Text("Add to phone calendar") }
                if (status.isNotBlank()) Text(status, style = MaterialTheme.typography.bodySmall)
                HorizontalDivider()
                Text("Your reminders", style = MaterialTheme.typography.titleMedium)
                if (tasks.isEmpty()) Text("No reminders yet.", style = MaterialTheme.typography.bodySmall)
                tasks.forEach { task ->
                    ElevatedCard(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(12.dp)) {
                            Text(task.title, style = MaterialTheme.typography.titleSmall)
                            Text(format(task.at), style = MaterialTheme.typography.bodySmall)
                            Text(task.state, style = MaterialTheme.typography.labelSmall)
                            TextButton(enabled = !busy, onClick = {
                                busy = true
                                scope.launch {
                                    try { store.cancel(account, task.id); tasks = store.list(account, workspace) }
                                    catch (e: Exception) { status = e.message ?: "Could not remove reminder." }
                                    finally { busy = false }
                                }
                            }) { Text(if (task.state == "Scheduled") "Cancel reminder" else "Remove") }
                        }
                    }
                }
            }
        },
        confirmButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text("Done") } })
}
