package au.datacube.app.ui.home

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import au.datacube.app.data.LocalDocumentProcessing
import au.datacube.app.ui.theme.DataCubeColors
import io.github.jan.supabase.auth.user.UserInfo

@Composable
fun HomeScreen(
    modifier: Modifier = Modifier,
    user: UserInfo?,
    recentDocuments: List<LocalDocumentProcessing>,
    onImportDocument: () -> Unit,
    onNavigateToDocuments: () -> Unit,
    onNavigateToStudy: () -> Unit,
    onNavigateToChat: () -> Unit
) {
    val displayName = user?.email?.substringBefore('@') ?: "there"

    LazyColumn(
        modifier = modifier
            .fillMaxSize()
            .statusBarsPadding(),
        contentPadding = PaddingValues(bottom = 24.dp)
    ) {
        // ── Header ──
        item {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(
                        Brush.verticalGradient(
                            colors = listOf(DataCubeColors.Navy, DataCubeColors.Navy)
                        )
                    )
                    .padding(horizontal = 24.dp, vertical = 32.dp)
            ) {
                Column {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            modifier = Modifier
                                .size(40.dp)
                                .clip(CircleShape)
                                .background(DataCubeColors.LightBlue),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                displayName.take(1).uppercase(),
                                color = Color.White,
                                fontWeight = FontWeight.Bold,
                                style = MaterialTheme.typography.titleMedium
                            )
                        }
                        Spacer(Modifier.width(12.dp))
                        Column {
                            Text(
                                "DATACUBE AU",
                                style = MaterialTheme.typography.labelSmall,
                                color = DataCubeColors.LightBlue,
                                fontWeight = FontWeight.Bold,
                                letterSpacing = androidx.compose.ui.unit.TextUnit(1.5f, androidx.compose.ui.unit.TextUnitType.Sp)
                            )
                            Text(
                                "Hey, $displayName",
                                style = MaterialTheme.typography.titleMedium,
                                color = Color.White,
                                fontWeight = FontWeight.SemiBold
                            )
                        }
                    }
                    Spacer(Modifier.height(24.dp))
                    Text(
                        "Your learning workspace",
                        style = MaterialTheme.typography.headlineMedium,
                        color = Color.White,
                        fontWeight = FontWeight.Bold
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        "Documents, AI tools and study sessions — private by default.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Spacer(Modifier.height(20.dp))
                    Button(
                        onClick = onImportDocument,
                        colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary)
                    ) {
                        Icon(Icons.Outlined.Add, null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("Add a document")
                    }
                }
            }
        }

        // ── Quick actions ──
        item {
            Spacer(Modifier.height(24.dp))
            Text(
                "Quick actions",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(horizontal = 24.dp)
            )
            Spacer(Modifier.height(12.dp))
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                QuickActionCard(
                    modifier = Modifier.weight(1f),
                    icon = Icons.Outlined.Chat,
                    label = "AU Chat",
                    tint = MaterialTheme.colorScheme.primary,
                    onClick = onNavigateToChat
                )
                QuickActionCard(
                    modifier = Modifier.weight(1f),
                    icon = Icons.Outlined.School,
                    label = "Study",
                    tint = MaterialTheme.colorScheme.primary,
                    onClick = onNavigateToStudy
                )
                QuickActionCard(
                    modifier = Modifier.weight(1f),
                    icon = Icons.Outlined.Folder,
                    label = "Documents",
                    tint = MaterialTheme.colorScheme.primary,
                    onClick = onNavigateToDocuments
                )
            }
        }

        // ── Recent documents ──
        if (recentDocuments.isNotEmpty()) {
            item {
                Spacer(Modifier.height(24.dp))
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 24.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        "Recent documents",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold
                    )
                    TextButton(onClick = onNavigateToDocuments) { Text("See all") }
                }
            }
            items(recentDocuments.take(3)) { item ->
                RecentDocumentRow(item)
            }
        } else {
            item {
                Spacer(Modifier.height(24.dp))
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 24.dp),
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.primaryContainer
                    )
                ) {
                    Row(
                        Modifier.padding(20.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            Icons.Outlined.AutoAwesome,
                            null,
                            tint = MaterialTheme.colorScheme.primary
                        )
                        Spacer(Modifier.width(16.dp))
                        Column {
                            Text(
                                "Import your first document",
                                fontWeight = FontWeight.SemiBold,
                                color = MaterialTheme.colorScheme.onPrimaryContainer
                            )
                            Text(
                                "PDF, DOCX, TXT, RTF and Markdown — processed on-device.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onPrimaryContainer
                            )
                        }
                    }
                }
            }
        }

        // ── Privacy note ──
        item {
            Spacer(Modifier.height(24.dp))
            Text(
                "Documents are processed privately on this device. Cloud AI features are optional.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 24.dp)
            )
        }
    }
}

@Composable
private fun QuickActionCard(
    modifier: Modifier = Modifier,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    tint: Color,
    onClick: () -> Unit
) {
    Card(
        onClick = onClick,
        modifier = modifier,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(
            modifier = Modifier.padding(14.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Box(
                modifier = Modifier
                    .size(40.dp)
                    .clip(CircleShape)
                    .background(tint.copy(alpha = 0.12f)),
                contentAlignment = Alignment.Center
            ) {
                Icon(icon, null, tint = tint, modifier = Modifier.size(20.dp))
            }
            Spacer(Modifier.height(8.dp))
            Text(label, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
private fun RecentDocumentRow(item: LocalDocumentProcessing) {
    ListItem(
        leadingContent = {
            Icon(
                if (item.document.extension == "pdf") Icons.Outlined.PictureAsPdf
                else Icons.Outlined.Description,
                null,
                tint = MaterialTheme.colorScheme.primary
            )
        },
        headlineContent = {
            Text(item.document.name, maxLines = 1, fontWeight = FontWeight.Medium)
        },
        supportingContent = {
            Text(
                "${item.document.extension.uppercase()} · ${item.document.sizeBytes / 1024} KB",
                style = MaterialTheme.typography.bodySmall
            )
        },
        trailingContent = {
            Icon(Icons.Outlined.ChevronRight, null)
        }
    )
    HorizontalDivider(modifier = Modifier.padding(horizontal = 16.dp))
}
