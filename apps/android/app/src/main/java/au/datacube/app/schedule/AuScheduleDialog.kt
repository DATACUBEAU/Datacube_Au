package au.datacube.app.schedule

import android.Manifest
import android.app.DatePickerDialog
import android.app.TimePickerDialog
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
import java.util.Calendar
import java.util.Date

@Composable
fun AuScheduleDialog(account: String, workspace: String? = null, initialTitle: String = "",
    onDismiss: () -> Unit) {
    val context = LocalContext.current
    val store = remember(context) { AuReminderStore(context) }
    val scope = rememberCoroutineScope()
    var title by remember(initialTitle) { mutableStateOf(initialTitle.take(240)) }
    val proposed = remember(initialTitle) { AuScheduleIntent.proposedTime(initialTitle) }
    var at by remember(initialTitle) { mutableLongStateOf(proposed ?: System.currentTimeMillis() + 60 * 60 * 1000L) }
    var timeChosen by remember(initialTitle) { mutableStateOf(proposed != null) }
    var tasks by remember { mutableStateOf(store.list(account, workspace)) }
    var status by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        status = if (granted) "Notifications enabled. Save your reminder." else "Notifications are off. Enable them in Android settings."
    }
    fun format(value: Long) = DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(value))
    fun chooseDate() {
        val cal = Calendar.getInstance().apply { timeInMillis = at }
        DatePickerDialog(context, { _, y, m, d ->
            cal.set(y, m, d)
            at = cal.timeInMillis
        }, cal.get(Calendar.YEAR), cal.get(Calendar.MONTH), cal.get(Calendar.DAY_OF_MONTH)).apply {
            datePicker.minDate = System.currentTimeMillis()
        }.show()
    }
    fun chooseTime() {
        val cal = Calendar.getInstance().apply { timeInMillis = at }
        TimePickerDialog(context, { _, h, m ->
            cal.set(Calendar.HOUR_OF_DAY, h); cal.set(Calendar.MINUTE, m)
            cal.set(Calendar.SECOND, 0); cal.set(Calendar.MILLISECOND, 0)
            at = cal.timeInMillis
            timeChosen = true
        }, cal.get(Calendar.HOUR_OF_DAY), cal.get(Calendar.MINUTE),
            android.text.format.DateFormat.is24HourFormat(context)).show()
    }
    fun enabled(): Boolean {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return false
        return manager.areNotificationsEnabled() &&
            (Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) &&
            manager.getNotificationChannel(AuReminderStore.CHANNEL)?.importance != NotificationManager.IMPORTANCE_NONE
    }
    val valid = title.isNotBlank() && timeChosen && at > System.currentTimeMillis() && !busy
    DataCubeDialog(onDismissRequest = { if (!busy) onDismiss() }, title = { Text("Schedules") },
        text = {
            Column(Modifier.heightIn(max = 500.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(title, { title = it.take(240) }, label = { Text("Study task") },
                    modifier = Modifier.fillMaxWidth(), maxLines = 3)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = ::chooseDate, modifier = Modifier.weight(1f)) { Text("Choose date") }
                    OutlinedButton(onClick = ::chooseTime, modifier = Modifier.weight(1f)) { Text("Choose time") }
                }
                Text(format(at), style = MaterialTheme.typography.titleSmall)
                Text(if (timeChosen) "Review the date and time before saving." else "Choose a time to enable scheduling.", style = MaterialTheme.typography.bodySmall)
                Text("Reminders work offline. Android may delay delivery to save battery.", style = MaterialTheme.typography.bodySmall)
                Button(enabled = valid, onClick = {
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
                                store.add(account, workspace, title, at)
                                tasks = store.list(account, workspace)
                                title = ""
                                timeChosen = false
                                status = "Reminder saved."
                            } catch (e: Exception) {
                                status = e.message ?: "Could not schedule reminder."
                            } finally { busy = false }
                        }
                    }
                }, modifier = Modifier.fillMaxWidth()) { Text("Schedule AU reminder") }
                OutlinedButton(enabled = valid, onClick = {
                    try {
                        context.startActivity(Intent(Intent.ACTION_INSERT, CalendarContract.Events.CONTENT_URI)
                            .putExtra(CalendarContract.Events.TITLE, title.trim())
                            .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, at)
                            .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, at + 30 * 60 * 1000L))
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
