package au.datacube.app.ui.profile

import android.os.Build
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import au.datacube.app.BuildConfig
import au.datacube.app.auth.SupabaseClient
import au.datacube.app.ui.common.DataCubeDialog
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.util.UUID

/** Optional support report; no hardware identifiers, permissions or background uploads. */
@Composable
fun AuDeviceDiagnosticsDialog(accountId: String, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val prefs = remember(context) { context.getSharedPreferences("au_support_installations", android.content.Context.MODE_PRIVATE) }
    val manufacturer = Build.MANUFACTURER.take(60)
    val model = Build.MODEL.take(80)
    val os = Build.VERSION.RELEASE.take(32)
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf("") }
    fun submit(remove: Boolean) {
        busy = true
        scope.launch {
            try {
                check(SupabaseClient.auth.currentUserOrNull()?.id == accountId)
                val report = if (remove) JsonNull else {
                    val installation = prefs.getString(accountId, null) ?: UUID.randomUUID().toString().also {
                        prefs.edit().putString(accountId, it).apply()
                    }
                    buildJsonObject {
                        put("installation_id", installation)
                        put("manufacturer", manufacturer)
                        put("model", model)
                        put("android_version", os)
                        put("sdk", Build.VERSION.SDK_INT)
                        put("app_version", BuildConfig.VERSION_NAME.take(32))
                        put("app_version_code", BuildConfig.VERSION_CODE)
                        put("reported_at", java.time.Instant.now().toString())
                    }
                }
                SupabaseClient.auth.updateUser {
                    data { put("au_device_diagnostics", report) }
                }
                if (remove) prefs.edit().remove(accountId).apply()
                message = if (remove) "Shared device report removed." else "Device report shared with AU support."
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { message = "Unable to update the report. Check your connection and account." }
            finally { busy = false }
        }
    }
    DataCubeDialog(onDismissRequest = { if (!busy) onDismiss() }, title = { Text("Device support information") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Optional: share device compatibility information with the AU administrator. Only the latest report is retained in your account profile.")
                Text("$manufacturer $model")
                Text("Android $os · AU ${BuildConfig.VERSION_NAME}")
                Text("Includes a random app installation ID, not your IMEI, serial number, phone number or location. No background tracking.", style = MaterialTheme.typography.bodySmall)
                if (message.isNotBlank()) Text(message, style = MaterialTheme.typography.bodySmall)
                TextButton(enabled = !busy, onClick = { submit(true) }) { Text("Remove shared report") }
            }
        },
        confirmButton = { Button(enabled = !busy, onClick = { submit(false) }) { Text(if (busy) "Working…" else "Share report") } },
        dismissButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text("Close") } })
}
