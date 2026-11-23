package au.datacube.app.ui.documents

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

    Column(Modifier.fillMaxSize().dataCubeBackdrop()) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 7.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            IconButton(onClick = onBack) {
                Icon(Icons.Outlined.ArrowBack, contentDescription = "Back to documents")
            }
            Surface(shape = RoundedCornerShape(12.dp), color = DataCubeColors.BlueLight) {
                Icon(
                    Icons.Outlined.Description,
                    contentDescription = null,
                    tint = DataCubeColors.Blue,
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
                    color = DataCubeColors.Navy
                )
                Text(
                    "${document.extension.uppercase()} · ${formatDocumentSize(document.sizeBytes)}",
                    color = DataCubeColors.TextSecondary,
                    style = MaterialTheme.typography.bodySmall
                )
            }
            IconButton(onClick = onBack) {
                Icon(Icons.Outlined.Close, contentDescription = "Close document workspace")
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
                    targetValue = if (selected) DataCubeColors.Blue else Color.White.copy(alpha = 0.86f),
                    label = "document-tab-container"
                )
                val foreground by animateColorAsState(
                    targetValue = if (selected) Color.White else DataCubeColors.Navy,
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
                    border = if (selected) null else BorderStroke(1.dp, DataCubeColors.Divider),
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
                extractionError = extractionError
            )
            1 -> SmartNoteWorkspace(document.name, textPreview, previewLoading)
            2 -> PredictionWorkspace(document.name, textPreview, previewLoading)
            3 -> PracticeWorkspace(document.name, textPreview, previewLoading)
            else -> PodcastWorkspace(document.name, textPreview, previewLoading)
        }
    }
}

private fun formatDocumentSize(bytes: Long): String =
    if (bytes >= 1024L * 1024L) {
        String.format("%.1f MB", bytes / (1024.0 * 1024.0))
    } else {
        "${(bytes / 1024L).coerceAtLeast(1L)} KB"
    }
