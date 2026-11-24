package au.datacube.app.ui.documents

import au.datacube.app.ui.common.DataCubeDialog
import au.datacube.app.schedule.AuScheduleDialog
import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import au.datacube.app.data.LocalDocument
import au.datacube.app.ui.theme.DataCubeColors
import au.datacube.app.ui.theme.dataCubeBackdrop

private val workspaceTabs = listOf(
    "AU Chat",
    "Smart Note",
    "Prediction",
    "Practice",
    "Podcast"
)

@Composable
fun DocumentWorkspaceScreen(
    document: LocalDocument,
    extractionStatus: String?,
    extractionProgress: Double?,
    extractionError: String?,
    textPreview: String?,
    previewTruncated: Boolean,
    previewLoading: Boolean,
    previewError: String?,
    onBack: () -> Unit,
    onOpenModels: () -> Unit = {},
    initialPrompt: String? = null,
    initialTab: Int = 0,
    accountId: String? = null
) {
    var selectedTab by remember(document.id, initialTab) { mutableIntStateOf(initialTab.coerceIn(0, workspaceTabs.lastIndex)) }
    var menuExpanded by remember(document.id) { mutableStateOf(false) }
    var immersive by remember(document.id) { mutableStateOf(false) }
    var newChatToken by remember(document.id) { mutableIntStateOf(0) }
    var chatHistoryOpen by remember(document.id) { mutableStateOf(false) }
    var showDetails by remember(document.id) { mutableStateOf(false) }
    var schedulesOpen by remember(document.id) { mutableStateOf(false) }
    if (schedulesOpen && accountId != null) {
        AuScheduleDialog(accountId, "document:${document.id}", "Review ${document.name}",
            onDismiss = { schedulesOpen = false })
    }


    if (showDetails) {
        DataCubeDialog(
            onDismissRequest = { showDetails = false },
            title = { Text("Document details") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(document.name)
                    Text("${document.extension.uppercase()} · ${formatDocumentSize(document.sizeBytes)}")
                    Text("Stored locally on this device")
                }
            },
            confirmButton = { TextButton(onClick = { showDetails = false }) { Text("Done") } }
        )
    }

    Column(Modifier.fillMaxSize().dataCubeBackdrop()) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 5.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            IconButton(onClick = onBack) {
                Icon(Icons.Outlined.ArrowBack, contentDescription = "Back to documents")
            }
            if (!immersive) {
                Spacer(Modifier.width(5.dp))
                Column(Modifier.weight(1f)) {
                    Text(document.name, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurface)
                    Text(
                        "${document.extension.uppercase()} · ${formatDocumentSize(document.sizeBytes)}",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            } else {
                Spacer(Modifier.weight(1f))
            }
            IconButton(onClick = { immersive = !immersive }) {
                Icon(
                    if (immersive) Icons.Outlined.FullscreenExit else Icons.Outlined.Fullscreen,
                    contentDescription = if (immersive) "Exit focus mode" else "Enter focus mode"
                )
            }
            Box {
                IconButton(onClick = { menuExpanded = true }) {
                    Icon(Icons.Outlined.MoreVert, contentDescription = "Document options and tools")
                }
                DropdownMenu(
                    expanded = menuExpanded,
                    onDismissRequest = { menuExpanded = false }
                ) {
                    Text(
                        "Document tools",
                        Modifier.padding(start = 16.dp, top = 8.dp, bottom = 5.dp),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.labelMedium
                    )
                    workspaceTabs.forEachIndexed { index, tab ->
                        val icon = when (index) {
                            0 -> Icons.Outlined.ChatBubbleOutline
                            1 -> Icons.Outlined.Notes
                            2 -> Icons.Outlined.BarChart
                            3 -> Icons.Outlined.Layers
                            else -> Icons.Outlined.Headphones
                        }
                        DropdownMenuItem(
                            text = {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(tab)
                                    if (selectedTab == index) {
                                        Spacer(Modifier.width(6.dp))
                                        Icon(Icons.Outlined.Check, null, Modifier.size(17.dp))
                                    }
                                }
                            },
                            leadingIcon = { Icon(icon, null) },
                            onClick = {
                                selectedTab = index
                                menuExpanded = false
                            }
                        )
                    }
                    HorizontalDivider()
                    if (accountId != null) {
                        DropdownMenuItem(
                            text = { Text("Schedules") },
                            leadingIcon = { Icon(Icons.Outlined.Schedule, null) },
                            onClick = { schedulesOpen = true; menuExpanded = false }
                        )
                    }
                    DropdownMenuItem(
                        text = { Text("New chat") },
                        leadingIcon = { Icon(Icons.Outlined.Add, null) },
                        onClick = {
                            selectedTab = 0
                            newChatToken += 1
                            menuExpanded = false
                        }
                    )
                    DropdownMenuItem(
                        text = { Text("History") },
                        leadingIcon = { Icon(Icons.Outlined.History, null) },
                        onClick = {
                            selectedTab = 0
                            chatHistoryOpen = true
                            menuExpanded = false
                        }
                    )
                    DropdownMenuItem(
                        text = { Text("Document info") },
                        leadingIcon = { Icon(Icons.Outlined.Info, null) },
                        onClick = { showDetails = true; menuExpanded = false }
                    )
                }
            }
        }

        when (selectedTab) {
            0 -> DocumentChatWorkspace(
                documentId = document.id,
                documentName = document.name,
                initialPrompt = initialPrompt,
                textPreview = textPreview,
                previewLoading = previewLoading,
                previewError = previewError,
                extractionStatus = extractionStatus,
                extractionProgress = extractionProgress,
                extractionError = extractionError,
                showHistoryPicker = chatHistoryOpen,
                onOpenHistory = { chatHistoryOpen = true },
                onDismissHistory = { chatHistoryOpen = false },
                newChatToken = newChatToken,
                onOpenModels = onOpenModels
            )
            1 -> SmartNoteWorkspace(document.name, textPreview, previewLoading, document.id)
            2 -> PredictionWorkspace(document.name, textPreview, previewLoading, document.id)
            3 -> PracticeWorkspace(document.name, textPreview, previewLoading, document.id)
            else -> PodcastWorkspace(document.id, document.name, textPreview, previewLoading)
        }
    }
}

private fun formatDocumentSize(bytes: Long): String =
    if (bytes >= 1024L * 1024L) {
        String.format("%.1f MB", bytes / (1024.0 * 1024.0))
    } else {
        "${(bytes / 1024L).coerceAtLeast(1L)} KB"
    }
