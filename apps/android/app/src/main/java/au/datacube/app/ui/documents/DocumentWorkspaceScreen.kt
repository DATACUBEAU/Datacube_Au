package au.datacube.app.ui.documents

import au.datacube.app.ui.common.DataCubeDialog
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
    initialPrompt: String? = null,
    initialTab: Int = 0
) {
    var selectedTab by remember(document.id, initialTab) { mutableIntStateOf(initialTab.coerceIn(0, workspaceTabs.lastIndex)) }
    var menuExpanded by remember(document.id) { mutableStateOf(false) }
    var chatHistoryOpen by remember(document.id) { mutableStateOf(false) }
    var showDetails by remember(document.id) { mutableStateOf(false) }

    if (menuExpanded) {
        DataCubeDialog(
            onDismissRequest = { menuExpanded = false },
            title = { Text("Document workspace", style = MaterialTheme.typography.titleLarge) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    TextButton(onClick = {
                        menuExpanded = false
                        selectedTab = 0
                        chatHistoryOpen = true
                    }, modifier = Modifier.fillMaxWidth()) {
                        Icon(Icons.Outlined.History, null)
                        Spacer(Modifier.width(10.dp))
                        Text("Chat history", Modifier.weight(1f))
                    }
                    TextButton(onClick = {
                        menuExpanded = false
                        showDetails = true
                    }, modifier = Modifier.fillMaxWidth()) {
                        Icon(Icons.Outlined.Info, null)
                        Spacer(Modifier.width(10.dp))
                        Text("Document details", Modifier.weight(1f))
                    }
                    TextButton(onClick = {
                        menuExpanded = false
                        selectedTab = 1
                    }, modifier = Modifier.fillMaxWidth()) {
                        Icon(Icons.Outlined.Notes, null)
                        Spacer(Modifier.width(10.dp))
                        Text("Smart Note", Modifier.weight(1f))
                    }
                    TextButton(onClick = {
                        menuExpanded = false
                        selectedTab = 4
                    }, modifier = Modifier.fillMaxWidth()) {
                        Icon(Icons.Outlined.Headphones, null)
                        Spacer(Modifier.width(10.dp))
                        Text("Podcast", Modifier.weight(1f))
                    }
                }
            },
            confirmButton = { TextButton(onClick = { menuExpanded = false }) { Text("Close") } }
        )
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
            Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 7.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            IconButton(onClick = onBack) {
                Icon(Icons.Outlined.ArrowBack, contentDescription = "Back to documents")
            }
            Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.primaryContainer) {
                Icon(
                    Icons.Outlined.Description,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(9.dp).size(25.dp)
                )
            }
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    document.name,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurface
                )
                Text(
                    "${document.extension.uppercase()} · ${formatDocumentSize(document.sizeBytes)}",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall
                )
            }
            IconButton(onClick = { menuExpanded = true }) {
                Icon(Icons.Outlined.MoreVert, contentDescription = "Document options")
            }
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 7.dp)
                .horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            workspaceTabs.forEachIndexed { index, title ->
                val selected = selectedTab == index
                val container by animateColorAsState(
                    targetValue = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surface,
                    label = "document-tab-container"
                )
                val foreground by animateColorAsState(
                    targetValue = if (selected) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface,
                    label = "document-tab-content"
                )
                val icon = when (index) {
                    0 -> Icons.Outlined.ChatBubbleOutline
                    1 -> Icons.Outlined.Notes
                    2 -> Icons.Outlined.BarChart
                    3 -> Icons.Outlined.Layers
                    else -> Icons.Outlined.Headphones
                }
                Surface(
                    onClick = { selectedTab = index },
                    shape = RoundedCornerShape(24.dp),
                    color = container,
                    border = if (selected) null else BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                    shadowElevation = if (selected) 3.dp else 0.dp
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 11.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(icon, contentDescription = null, tint = foreground, modifier = Modifier.size(19.dp))
                        Spacer(Modifier.width(7.dp))
                        Text(
                            title,
                            maxLines = 1,
                            color = foreground,
                            fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
                            style = MaterialTheme.typography.labelLarge
                        )
                    }
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
                onDismissHistory = { chatHistoryOpen = false }
            )
            1 -> SmartNoteWorkspace(document.name, textPreview, previewLoading)
            2 -> PredictionWorkspace(document.name, textPreview, previewLoading)
            3 -> PracticeWorkspace(document.name, textPreview, previewLoading)
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
