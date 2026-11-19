package au.datacube.app.ui.profile

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import io.github.jan.supabase.auth.user.UserInfo
import au.datacube.app.models.ModelBackupProgress
import au.datacube.app.models.InstalledModelRecord

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProfileScreen(
    modifier: Modifier = Modifier,
    user: UserInfo?,
    onSignOut: () -> Unit,
    onBackupModels: () -> Unit,
    onRestoreModels: () -> Unit,
    modelOperationBusy: Boolean,
    modelBackupProgress: ModelBackupProgress?,
    installedModels: List<InstalledModelRecord>,
    onCancelModelOperation: () -> Unit
) {
    val email = user?.email ?: "—"
    val displayName = email.substringBefore('@')

    Scaffold(
        modifier = modifier,
        topBar = {
            TopAppBar(title = { Text("Profile", fontWeight = FontWeight.Bold) })
        }
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // ── Avatar + name ──
            item {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                    elevation = CardDefaults.cardElevation(2.dp)
                ) {
                    Row(
                        modifier = Modifier.padding(20.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Box(
                            modifier = Modifier
                                .size(56.dp)
                                .clip(CircleShape)
                                .background(MaterialTheme.colorScheme.primary),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                displayName.take(1).uppercase(),
                                color = MaterialTheme.colorScheme.onPrimary,
                                fontWeight = FontWeight.Bold,
                                style = MaterialTheme.typography.headlineSmall
                            )
                        }
                        Spacer(Modifier.width(16.dp))
                        Column {
                            Text(displayName, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.titleMedium)
                            Text(email, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            if (user != null) {
                                Spacer(Modifier.height(4.dp))
                                AssistChip(
                                    onClick = {},
                                    label = { Text("Signed in", style = MaterialTheme.typography.labelSmall) },
                                    leadingIcon = { Icon(Icons.Outlined.CheckCircle, null, modifier = Modifier.size(14.dp)) }
                                )
                            }
                        }
                    }
                }
            }

            // ── Account settings ──
            item {
                Text("Account", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 4.dp))
            }
            item {
                ProfileRow(icon = Icons.Outlined.Person, label = "Account details", onClick = {})
                ProfileRow(icon = Icons.Outlined.Notifications, label = "Notifications", onClick = {})
                ProfileRow(icon = Icons.Outlined.Security, label = "Privacy & security", onClick = {})
            }

            // ── Subscription ──
            item {
                Text("Subscription", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 4.dp, vertical = 4.dp))
            }
            item {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)
                ) {
                    Row(Modifier.padding(20.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Outlined.Star, null, tint = MaterialTheme.colorScheme.primary)
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text("Manage subscription", fontWeight = FontWeight.SemiBold)
                            Text(
                                "View plan, usage and billing on the DataCube AU website.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onPrimaryContainer
                            )
                        }
                        Icon(Icons.Outlined.OpenInNew, null, modifier = Modifier.size(18.dp))
                    }
                }
            }

            // ── Usage ──
            item {
                Text("Usage", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 4.dp, vertical = 4.dp))
            }
            item {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                    elevation = CardDefaults.cardElevation(2.dp)
                ) {
                    Column(Modifier.padding(20.dp)) {
                        Text("Cloud AI usage", fontWeight = FontWeight.SemiBold)
                        Spacer(Modifier.height(4.dp))
                        Text(
                            "Cloud AI usage is tracked server-side and subject to your subscription plan. Local processing is unlimited.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Spacer(Modifier.height(12.dp))
                        OutlinedButton(onClick = {}, modifier = Modifier.fillMaxWidth()) {
                            Text("View usage details")
                        }
                    }
                }
            }

            // ── Model backup and restore ──
            item {
                Text(
                    "Local AI models",
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 4.dp, vertical = 4.dp)
                )
            }
            item {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.surface
                    ),
                    elevation = CardDefaults.cardElevation(2.dp)
                ) {
                    Column(
                        modifier = Modifier.padding(20.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        Text("Model backups", fontWeight = FontWeight.SemiBold)
                        Text(
                            "Export installed models into one portable ZIP file. Choose Documents, an SD card, USB storage or a connected cloud drive in the Android file picker. The backup is stored outside DataCube AU and can be restored after reinstalling the app.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Text(
                            "Restore checks file sizes and SHA-256 hashes. Existing model folders are never overwritten.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Text(
                            "Installed models",
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.SemiBold
                        )
                        if (installedModels.isEmpty()) {
                            Text(
                                "No model files are installed in local model storage yet. Models installed through the DataCube model manager will appear here.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        } else {
                            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                installedModels.forEach { model ->
                                    Surface(
                                        color = MaterialTheme.colorScheme.surfaceVariant,
                                        shape = MaterialTheme.shapes.medium,
                                        modifier = Modifier.fillMaxWidth()
                                    ) {
                                        Column(Modifier.padding(12.dp)) {
                                            Text(
                                                model.manifest?.displayName ?: model.modelId,
                                                fontWeight = FontWeight.SemiBold
                                            )
                                            Text(
                                                model.manifest?.sourceRepository ?: "Model metadata unavailable",
                                                style = MaterialTheme.typography.bodySmall,
                                                color = MaterialTheme.colorScheme.onSurfaceVariant
                                            )
                                            Text(
                                                "${model.fileCount} files • ${formatBackupBytes(model.totalBytes)}",
                                                style = MaterialTheme.typography.bodySmall,
                                                color = MaterialTheme.colorScheme.onSurfaceVariant
                                            )
                                        }
                                    }
                                }
                            }
                        }
                        if (modelOperationBusy) {
                            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text(
                                    modelBackupProgress?.phase ?: "Processing model backup",
                                    style = MaterialTheme.typography.labelLarge
                                )
                                val progress = modelBackupProgress
                                val progressDetail = listOfNotNull(
                                    progress?.currentModel,
                                    progress?.currentFile
                                ).joinToString(" • ")
                                if (progressDetail.isNotBlank()) {
                                    Text(
                                        progressDetail,
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                }
                                if (progress != null && progress.totalBytes > 0L) {
                                    LinearProgressIndicator(
                                        progress = progress.fraction,
                                        modifier = Modifier.fillMaxWidth()
                                    )
                                    Text(
                                        "${formatBackupBytes(progress.completedBytes)} of ${formatBackupBytes(progress.totalBytes)} • ${progress.completedFiles.coerceAtMost(progress.totalFiles)} / ${progress.totalFiles} files",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                } else {
                                    LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                                }
                                OutlinedButton(
                                    onClick = onCancelModelOperation,
                                    modifier = Modifier.fillMaxWidth()
                                ) {
                                    Text("Cancel operation")
                                }
                            }
                        }
                        Button(
                            onClick = onBackupModels,
                            enabled = !modelOperationBusy,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text(if (modelOperationBusy) "Processing…" else "Export model backup")
                        }
                        OutlinedButton(
                            onClick = onRestoreModels,
                            enabled = !modelOperationBusy,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text("Restore from backup")
                        }
                    }
                }
            }

            // ── Sign out ──
            item {
                Spacer(Modifier.height(8.dp))
                Button(
                    onClick = onSignOut,
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.errorContainer,
                        contentColor = MaterialTheme.colorScheme.onErrorContainer
                    )
                ) {
                    Icon(Icons.Outlined.Logout, null)
                    Spacer(Modifier.width(8.dp))
                    Text("Sign out", fontWeight = FontWeight.SemiBold)
                }
            }

            item {
                Text(
                    "DataCube AU • ${au.datacube.app.BuildConfig.VERSION_NAME}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 4.dp)
                )
            }
        }
    }
}

@Composable
private fun ProfileRow(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    onClick: () -> Unit
) {
    Surface(onClick = onClick, modifier = Modifier.fillMaxWidth()) {
        ListItem(
            leadingContent = {
                Icon(icon, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            },
            headlineContent = { Text(label) },
            trailingContent = { Icon(Icons.Outlined.ChevronRight, null) }
        )
    }
    HorizontalDivider()
}


private fun formatBackupBytes(bytes: Long): String {
    if (bytes < 1024L) return "${bytes} B"
    val kib = bytes / 1024.0
    if (kib < 1024.0) return String.format(java.util.Locale.US, "%.1f KB", kib)
    val mib = kib / 1024.0
    if (mib < 1024.0) return String.format(java.util.Locale.US, "%.1f MB", mib)
    val gib = mib / 1024.0
    return String.format(java.util.Locale.US, "%.2f GB", gib)
}
