package au.datacube.app.ui.profile

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.res.painterResource
import au.datacube.app.R
import androidx.compose.ui.unit.dp
import io.github.jan.supabase.auth.user.UserInfo

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProfileScreen(
    modifier: Modifier = Modifier,
    user: UserInfo?,
    onSignOut: () -> Unit,
    onBackupModels: () -> Unit,
    onRestoreModels: () -> Unit,
    onBack: () -> Unit = {}
) {
    val email = user?.email ?: "—"
    val displayName = email.substringBefore('@')
    var showProfile by remember { mutableStateOf(false) }

    if (showProfile) {
        AlertDialog(
            onDismissRequest = { showProfile = false },
            title = { Text("Profile", fontWeight = FontWeight.Bold) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(displayName, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    Text(email, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (user != null) Text("Signed in", color = MaterialTheme.colorScheme.primary)
                }
            },
            confirmButton = { TextButton(onClick = { showProfile = false }) { Text("Close") } }
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
                    IconButton(onClick = onBack) {
                        Icon(Icons.Outlined.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        }
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // ── Account settings ──
            item {
                Text("Account", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 4.dp))
            }
            item {
                ProfileRow(icon = Icons.Outlined.Person, label = "Profile", onClick = { showProfile = true })
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
                        Button(
                            onClick = onBackupModels,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text("Export model backup")
                        }
                        OutlinedButton(
                            onClick = onRestoreModels,
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
