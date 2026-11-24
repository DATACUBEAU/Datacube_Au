package au.datacube.app.ui.profile

import au.datacube.app.ui.common.DataCubeDialog
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.foundation.Image
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import au.datacube.app.R
import kotlinx.coroutines.launch
import kotlinx.coroutines.CancellationException
import au.datacube.app.ui.theme.ThemePreference
import io.github.jan.supabase.auth.user.UserInfo

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProfileScreen(
    modifier: Modifier = Modifier,
    user: UserInfo?,
    onSignOut: () -> Unit,
    onBackupModels: () -> Unit,
    onRestoreModels: () -> Unit,
    onBack: () -> Unit = {},
    themePreference: ThemePreference = ThemePreference.SYSTEM,
    onThemeChange: (ThemePreference) -> Unit = {},
    onOpenModels: () -> Unit = {},
    onOpenVault: () -> Unit = {},
    onOpenSubscription: () -> Unit = {},
    onEnableNotifications: () -> Unit = {}
) {
    val email = user?.email ?: "—"
    var showProfile by remember { mutableStateOf(false) }
    var showBackups by remember { mutableStateOf(false) }
    var showPersonalization by remember(user?.id) { mutableStateOf(false) }
    if (showPersonalization && user != null) AuPersonalizationDialog(user.id) { showPersonalization = false }
    var showDeviceReport by remember(user?.id) { mutableStateOf(false) }
    var reportBusy by remember(user?.id) { mutableStateOf(false) }
    var reportStatus by remember(user?.id) { mutableStateOf("") }
    val reportScope = rememberCoroutineScope()
    fun submitReport(remove: Boolean) {
        val account = user?.id ?: return
        if (reportBusy) return
        reportBusy = true
        reportScope.launch {
            try {
                val ok = DeviceCompatibilityReport.send(account, remove)
                reportStatus = if (!ok) "Request unavailable. Try again when connected."
                    else if (remove) "Report removed." else "Compatibility report shared."
            } catch (e: CancellationException) { throw e }
            catch (_: Exception) { reportStatus = "Request unavailable. Try again when connected." }
            finally { reportBusy = false }
        }
    }
    if (showDeviceReport && user != null) {
        DataCubeDialog(
            onDismissRequest = { if (!reportBusy) showDeviceReport = false },
            title = { Text("Device compatibility") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("Optional: share your phone model, Android version and AU version with support to help diagnose compatibility. No device identifier or location is sent.")
                    Text(android.os.Build.MANUFACTURER + " " + android.os.Build.MODEL)
                    Text("Android " + android.os.Build.VERSION.RELEASE + " · AU " + au.datacube.app.BuildConfig.VERSION_NAME)
                    if (reportStatus.isNotBlank()) Text(reportStatus, style = MaterialTheme.typography.bodySmall)
                    OutlinedButton(onClick = { submitReport(true) }, enabled = !reportBusy) { Text("Remove shared report") }
                }
            },
            confirmButton = { TextButton(onClick = { submitReport(false) }, enabled = !reportBusy) { Text(if (reportBusy) "Working…" else "Share report") } },
            dismissButton = { TextButton(onClick = { showDeviceReport = false }, enabled = !reportBusy) { Text("Close") } }
        )
    }


    if (showProfile) {
        DataCubeDialog(
            onDismissRequest = { showProfile = false },
            title = { Text("Profile") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(email.substringBefore('@'), fontWeight = FontWeight.SemiBold)
                    Text(email, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            },
            confirmButton = { TextButton(onClick = { showProfile = false }) { Text("Close") } }
        )
    }

    if (showBackups) {
        DataCubeDialog(
            onDismissRequest = { showBackups = false },
            title = { Text("Model backups") },
            text = { Text("Keep a copy of your downloaded models.") },
            confirmButton = {
                Column {
                    Button(onClick = { showBackups = false; onBackupModels() }, modifier = Modifier.fillMaxWidth()) {
                        Text("Export backup")
                    }
                    OutlinedButton(onClick = { showBackups = false; onRestoreModels() }, modifier = Modifier.fillMaxWidth()) {
                        Text("Smart restore archive")
                    }
                    OutlinedButton(onClick = { showBackups = false; onOpenVault() }, modifier = Modifier.fillMaxWidth()) {
                        Text("Open Model Vault")
                    }
                }
            },
            dismissButton = { TextButton(onClick = { showBackups = false }) { Text("Close") } }
        )
    }

    Scaffold(
        modifier = modifier,
        topBar = {
            TopAppBar(
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Image(
                            painter = painterResource(R.drawable.datacube_logo),
                            contentDescription = "DataCube AU",
                            modifier = Modifier.size(30.dp)
                        )
                        Spacer(Modifier.width(10.dp))
                        Text("Settings", fontWeight = FontWeight.Bold)
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.Outlined.ArrowBack, "Back") }
                }
            )
        }
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            item { SettingsSection("Appearance") }
            item {
                Surface(
                    shape = RoundedCornerShape(20.dp),
                    color = MaterialTheme.colorScheme.surface,
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)
                ) {
                    Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text("Display mode", fontWeight = FontWeight.SemiBold)
                        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                            SegmentedButton(
                                selected = themePreference == ThemePreference.SYSTEM,
                                onClick = { onThemeChange(ThemePreference.SYSTEM) },
                                shape = SegmentedButtonDefaults.itemShape(0, 3)
                            ) { Icon(Icons.Outlined.BrightnessAuto, "System", Modifier.size(18.dp)) }
                            SegmentedButton(
                                selected = themePreference == ThemePreference.LIGHT,
                                onClick = { onThemeChange(ThemePreference.LIGHT) },
                                shape = SegmentedButtonDefaults.itemShape(1, 3)
                            ) { Icon(Icons.Outlined.LightMode, "Day", Modifier.size(18.dp)) }
                            SegmentedButton(
                                selected = themePreference == ThemePreference.DARK,
                                onClick = { onThemeChange(ThemePreference.DARK) },
                                shape = SegmentedButtonDefaults.itemShape(2, 3)
                            ) { Icon(Icons.Outlined.DarkMode, "Night", Modifier.size(18.dp)) }
                        }
                    }
                }
            }
            item { SettingsSection("Membership") }
            item {
                SettingsEntry(
                    Icons.Outlined.CreditCard, "Manage subscription", "Usage and plan & billing", onOpenSubscription
                )
            }
            item { SettingsSection("On-device") }
            item {
                SettingsEntry(Icons.Outlined.Memory, "Models", "Download or import models", onOpenModels)
            }
            item {
                SettingsEntry(Icons.Outlined.Backup, "Backups", "Export or restore models", { showBackups = true })
            }
            item {
                SettingsEntry(Icons.Outlined.NotificationsNone, "Notifications", "Enable task updates", onEnableNotifications)
            }
            item { SettingsSection("App updates") }
            item { UpdateSettingsCard() }
            item { SettingsSection("Account") }
            if (user != null) item { SettingsEntry(Icons.Outlined.PersonOutline, "AU personalization", "Response style and saved memories", { showPersonalization = true }) }
            if (user != null) item { SettingsEntry(Icons.Outlined.Info, "Device compatibility", "Optional support report", { showDeviceReport = true }) }
            item { SettingsEntry(Icons.Outlined.PersonOutline, "Profile", email, { showProfile = true }) }
            item {
                OutlinedButton(
                    onClick = onSignOut,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Icon(Icons.Outlined.Logout, null)
                    Spacer(Modifier.width(8.dp))
                    Text("Sign out")
                }
            }
            item {
                Text(
                    "DataCube AU • " + au.datacube.app.BuildConfig.VERSION_NAME,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(4.dp)
                )
            }
        }
    }
}

@Composable
private fun SettingsSection(title: String) {
    Text(
        title,
        style = MaterialTheme.typography.labelLarge,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(start = 4.dp, top = 8.dp)
    )
}

@Composable
private fun SettingsEntry(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    subtitle: String,
    onClick: () -> Unit
) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(18.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)
    ) {
        Row(
            Modifier.fillMaxWidth().padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(icon, null, tint = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(title, fontWeight = FontWeight.SemiBold)
                Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Icon(Icons.Outlined.ChevronRight, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
