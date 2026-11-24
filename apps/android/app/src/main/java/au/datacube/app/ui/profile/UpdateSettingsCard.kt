package au.datacube.app.ui.profile

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.Update
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import au.datacube.app.BuildConfig
import au.datacube.app.updates.AndroidUpdateManager
import au.datacube.app.updates.AndroidUpdateRelease
import au.datacube.app.updates.InstallStatus
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/** Compact user-controlled update surface, not a modal overlay or silent installer. */
@Composable
fun UpdateSettingsCard() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var release by remember { mutableStateOf<AndroidUpdateRelease?>(null) }
    var checking by remember { mutableStateOf(false) }
    var downloading by remember { mutableStateOf(false) }
    var percent by remember { mutableIntStateOf(0) }
    var status by remember { mutableStateOf("") }
    var needsPermission by remember { mutableStateOf(false) }
    var complete by remember { mutableStateOf(false) }

    fun check() {
        if (checking || downloading) return
        checking = true
        status = "Checking for a newer AU version"
        scope.launch {
            try {
                val found = AndroidUpdateManager.check(context)
                release = found
                complete = false
                needsPermission = false
                status = if (found == null) "Your version is up to date."
                    else "Version ${found.versionName} is ready to download."
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Exception) {
                status = error.message ?: "Update check failed. Try again."
            } finally {
                checking = false
            }
        }
    }

    LaunchedEffect(Unit) { check() }

    Surface(
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        shape = RoundedCornerShape(20.dp)
    ) {
        Column(
            Modifier.fillMaxWidth().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Text("App updates", style = MaterialTheme.typography.titleMedium)
            Text(
                "Installed: " + BuildConfig.VERSION_NAME +
                    " · Updates preserve your documents and app settings.",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall
            )
            if (checking || downloading) {
                if (downloading) {
                    LinearProgressIndicator(
                        progress = { percent / 100f },
                        modifier = Modifier.fillMaxWidth()
                    )
                    Text("$percent% downloaded", style = MaterialTheme.typography.labelSmall)
                } else {
                    LinearProgressIndicator(Modifier.fillMaxWidth())
                }
            }
            if (status.isNotBlank()) {
                Text(
                    status,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            val current = release
            if (current != null) {
                Text(current.notes, style = MaterialTheme.typography.bodySmall)
                Text(
                    "Full APK · " + (current.sizeBytes / (1024 * 1024)) + " MB",
                    style = MaterialTheme.typography.labelSmall
                )
                Button(
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !checking && !downloading,
                    onClick = {
                        scope.launch {
                            try {
                                run {
                                    downloading = true
                                    percent = 0
                                    status = "Downloading signed update"
                                    AndroidUpdateManager.download(context, current) {
                                        kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) { percent = it }
                                    }
                                }
                                downloading = false
                                when (AndroidUpdateManager.launchInstaller(context, current)) {
                                    InstallStatus.OPENED_INSTALLER -> {
                                        status = "Approve the update in Android. Reopen AU when installation completes."
                                        complete = true
                                    }
                                    InstallStatus.PERMISSION_REQUIRED -> {
                                        needsPermission = true
                                        status = "Android requires your permission to install updates from AU."
                                    }
                                }
                            } catch (cancelled: CancellationException) {
                                throw cancelled
                            } catch (error: Exception) {
                                status = error.message ?: "The update could not be installed."
                            } finally {
                                downloading = false
                            }
                        }
                    }
                ) {
                    Icon(
                        if (complete) Icons.Outlined.Update else Icons.Outlined.Download,
                        contentDescription = null
                    )
                    Spacer(Modifier.width(8.dp))
                    Text(if (complete || needsPermission) "Install verified update" else "Download and update")
                }
            }
            if (needsPermission) {
                OutlinedButton(
                    modifier = Modifier.fillMaxWidth(),
                    onClick = { AndroidUpdateManager.openInstallPermissionSettings(context) }
                ) {
                    Text("Allow Android installation, then return")
                }
            }
            Text("AU checks for updates automatically. Downloads and installation require your approval.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            TextButton(
                onClick = ::check,
                enabled = !checking && !downloading,
                modifier = Modifier.fillMaxWidth()
            ) { Text("Check for updates") }
        }
    }
}
