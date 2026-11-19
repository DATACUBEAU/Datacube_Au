package au.datacube.app.ui.documents

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
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
import au.datacube.app.data.LocalJobStatus
import au.datacube.app.ui.theme.DataCubeColors
import au.datacube.app.ui.theme.dataCubeBackdrop

private val workspaceTabs = listOf("Overview", "AU Chat", "Smart Note", "Prediction", "Practice", "Podcast")

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
    onBack: () -> Unit
) {
    var selectedTab by remember(document.id) { mutableIntStateOf(0) }

    Column(Modifier.fillMaxSize().dataCubeBackdrop()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.Outlined.ArrowBack, "Back to documents") }
            Surface(shape = RoundedCornerShape(12.dp), color = DataCubeColors.BlueLight) {
                Icon(Icons.Outlined.Description, null, tint = DataCubeColors.Blue, modifier = Modifier.padding(9.dp).size(25.dp))
            }
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(document.name, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
                Text("${document.extension.uppercase()} · ${document.sizeBytes / 1024} KB", color = DataCubeColors.TextSecondary, style = MaterialTheme.typography.bodySmall)
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
                    targetValue = if (selected) DataCubeColors.Blue else Color.White.copy(alpha = 0.78f),
                    label = "document-tab-container"
                )
                val foreground by animateColorAsState(
                    targetValue = if (selected) Color.White else DataCubeColors.Navy,
                    label = "document-tab-content"
                )
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
                        val icon = when (index) {
                            0 -> Icons.Outlined.Description
                            1 -> Icons.Outlined.ChatBubbleOutline
                            2 -> Icons.Outlined.Notes
                            3 -> Icons.Outlined.BarChart
                            4 -> Icons.Outlined.Layers
                            else -> Icons.Outlined.Headphones
                        }
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
            0 -> OverviewWorkspace(
                document = document,
                extractionStatus = extractionStatus,
                extractionProgress = extractionProgress,
                extractionError = extractionError,
                textPreview = textPreview,
                previewTruncated = previewTruncated,
                previewLoading = previewLoading,
                previewError = previewError
            )
            1 -> ChatWorkspace()
            2 -> SmartNoteWorkspace()
            3 -> PredictionWorkspace()
            4 -> PracticeWorkspace()
            else -> PodcastWorkspace()
        }
    }
}

@Composable
private fun OverviewWorkspace(
    document: LocalDocument,
    extractionStatus: String?,
    extractionProgress: Double?,
    extractionError: String?,
    textPreview: String?,
    previewTruncated: Boolean,
    previewLoading: Boolean,
    previewError: String?
) {
    val extractionLabel = when (extractionStatus) {
        LocalJobStatus.QUEUED -> "Queued for on-device extraction"
        LocalJobStatus.RETRYABLE -> "Waiting to retry extraction"
        LocalJobStatus.RUNNING -> "Extracting on this device"
        LocalJobStatus.COMPLETED -> "Local text is ready"
        LocalJobStatus.FAILED -> "Text extraction unavailable"
        LocalJobStatus.CANCELLED -> "Extraction cancelled"
        else -> if (document.extension.lowercase() in setOf("pdf", "txt", "md")) {
            "Waiting for local extraction"
        } else {
            "Imported · preview not supported yet"
        }
    }
    val formattedSize = when {
        document.sizeBytes >= 1024L * 1024L -> String.format("%.1f MB", document.sizeBytes / (1024.0 * 1024.0))
        else -> "${(document.sizeBytes / 1024L).coerceAtLeast(1L)} KB"
    }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        Surface(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(20.dp),
            color = Color.White,
            border = BorderStroke(1.dp, DataCubeColors.Divider)
        ) {
            Column(Modifier.padding(17.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    WorkspaceIcon(Icons.Outlined.Description)
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text("Document overview", fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
                        Text(extractionLabel, color = DataCubeColors.TextSecondary, style = MaterialTheme.typography.bodySmall)
                    }
                }
                if (extractionStatus == LocalJobStatus.RUNNING) {
                    Spacer(Modifier.height(12.dp))
                    LinearProgressIndicator(
                        progress = { (extractionProgress ?: 0.0).toFloat().coerceIn(0f, 1f) },
                        modifier = Modifier.fillMaxWidth()
                    )
                }
                Spacer(Modifier.height(14.dp))
                HorizontalDivider(color = DataCubeColors.Divider)
                Spacer(Modifier.height(12.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Column(Modifier.weight(1f)) {
                        Text("FILE TYPE", color = DataCubeColors.TextSecondary, style = MaterialTheme.typography.labelSmall)
                        Text(document.extension.uppercase(), color = DataCubeColors.Navy, fontWeight = FontWeight.SemiBold)
                    }
                    Column(Modifier.weight(1f)) {
                        Text("FILE SIZE", color = DataCubeColors.TextSecondary, style = MaterialTheme.typography.labelSmall)
                        Text(formattedSize, color = DataCubeColors.Navy, fontWeight = FontWeight.SemiBold)
                    }
                    Column(Modifier.weight(1f)) {
                        Text("ADDED", color = DataCubeColors.TextSecondary, style = MaterialTheme.typography.labelSmall)
                        Text(
                            java.text.DateFormat.getDateInstance(java.text.DateFormat.MEDIUM)
                                .format(java.util.Date(document.createdAtEpochMs)),
                            color = DataCubeColors.Navy,
                            fontWeight = FontWeight.SemiBold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                }
            }
        }

        Surface(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(20.dp),
            color = Color.White,
            border = BorderStroke(1.dp, DataCubeColors.Divider)
        ) {
            Column(Modifier.padding(17.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Extracted text", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
                    Spacer(Modifier.weight(1f))
                    Text("ON DEVICE", style = MaterialTheme.typography.labelSmall, color = DataCubeColors.Blue, fontWeight = FontWeight.Bold)
                }
                Spacer(Modifier.height(8.dp))
                when {
                    previewLoading -> {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                            Spacer(Modifier.width(10.dp))
                            Text("Checking the local text preview…", color = DataCubeColors.TextSecondary)
                        }
                    }
                    previewError != null -> {
                        Text(previewError, color = DataCubeColors.TextSecondary)
                        Text("The original file remains stored in your private app storage.", color = DataCubeColors.TextSecondary, style = MaterialTheme.typography.bodySmall)
                    }
                    !textPreview.isNullOrBlank() -> {
                        SelectionContainer {
                            Text(
                                textPreview,
                                color = DataCubeColors.Navy,
                                style = MaterialTheme.typography.bodyMedium
                            )
                        }
                        if (previewTruncated) {
                            Spacer(Modifier.height(8.dp))
                            Text("Preview limited to the first 48,000 characters.", color = DataCubeColors.TextSecondary, style = MaterialTheme.typography.labelSmall)
                        }
                    }
                    extractionStatus == LocalJobStatus.FAILED -> {
                        Text(extractionError ?: "Text could not be extracted from this file.", color = DataCubeColors.TextSecondary)
                        Text("The original document is still available in your local library.", color = DataCubeColors.TextSecondary, style = MaterialTheme.typography.bodySmall)
                    }
                    extractionStatus == LocalJobStatus.QUEUED ||
                        extractionStatus == LocalJobStatus.RETRYABLE ||
                        extractionStatus == LocalJobStatus.RUNNING -> {
                        Text("Your document is being processed locally. The extracted text will appear here when the job completes.", color = DataCubeColors.TextSecondary)
                    }
                    document.extension.lowercase() !in setOf("pdf", "txt", "md") -> {
                        Text("Local text preview currently supports PDF, TXT and Markdown files. This file remains saved on your device.", color = DataCubeColors.TextSecondary)
                    }
                    else -> {
                        Text("No extracted text is available yet. Return to Documents and check the processing status.", color = DataCubeColors.TextSecondary)
                    }
                }
            }
        }

        Surface(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(18.dp),
            color = DataCubeColors.BluePale,
            border = BorderStroke(1.dp, DataCubeColors.Divider)
        ) {
            Row(Modifier.padding(15.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.PhoneAndroid, null, tint = DataCubeColors.Blue)
                Spacer(Modifier.width(10.dp))
                Text(
                    "Your file and extracted text stay in this app's private on-device storage.",
                    color = DataCubeColors.Navy,
                    style = MaterialTheme.typography.bodySmall
                )
            }
        }
    }
}

@Composable
private fun ChatWorkspace() {
    FeatureComingSoon(
        icon = Icons.Outlined.ChatBubbleOutline,
        title = "Document chat",
        description = "Ask questions and receive answers grounded in this document, with local citations.",
        detail = "Document retrieval and the local inference connection are not enabled in this build. Your document remains on this device."
    )
}

@Composable
private fun SmartNoteWorkspace() {
    FeatureComingSoon(
        icon = Icons.Outlined.Notes,
        title = "Smart notes",
        description = "Turn the document into structured notes, connected ideas and key takeaways.",
        detail = "Document-grounded note generation is not enabled yet."
    )
}

@Composable
private fun PredictionWorkspace() {
    FeatureComingSoon(
        icon = Icons.Outlined.BarChart,
        title = "Study prediction",
        description = "Identify high-value topics and likely assessment questions from your material.",
        detail = "Prediction generation is not enabled in this build."
    )
}

@Composable
private fun PracticeWorkspace() {
    FeatureComingSoon(
        icon = Icons.Outlined.Layers,
        title = "Practice questions",
        description = "Generate quizzes and revision exercises based on the content of this document.",
        detail = "Question generation and answer evaluation are not enabled in this build."
    )
}

@Composable
private fun PodcastWorkspace() {
    FeatureComingSoon(
        icon = Icons.Outlined.Headphones,
        title = "Audio summary",
        description = "Listen to a spoken summary of the most important ideas in your document.",
        detail = "Audio generation and playback are not enabled in this build."
    )
}

@Composable
private fun FeatureComingSoon(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    description: String,
    detail: String
) {
    Column(
        Modifier.fillMaxSize().padding(20.dp),
        verticalArrangement = Arrangement.Center
    ) {
        Surface(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(22.dp),
            color = Color.White,
            border = BorderStroke(1.dp, DataCubeColors.Divider)
        ) {
            Column(
                Modifier.fillMaxWidth().padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                WorkspaceIcon(icon)
                Spacer(Modifier.height(16.dp))
                Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
                Spacer(Modifier.height(8.dp))
                Text(description, color = DataCubeColors.TextSecondary)
                Spacer(Modifier.height(16.dp))
                Surface(shape = RoundedCornerShape(20.dp), color = DataCubeColors.BlueLight) {
                    Text(
                        "COMING SOON",
                        modifier = Modifier.padding(horizontal = 13.dp, vertical = 7.dp),
                        color = DataCubeColors.BlueDark,
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.Bold
                    )
                }
                Spacer(Modifier.height(14.dp))
                Text(detail, color = DataCubeColors.TextSecondary, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

@Composable
private fun WorkspaceIcon(icon: androidx.compose.ui.graphics.vector.ImageVector) {
    Surface(shape = RoundedCornerShape(16.dp), color = DataCubeColors.BlueLight) {
        Icon(icon, null, tint = DataCubeColors.Blue, modifier = Modifier.padding(13.dp).size(28.dp))
    }
}

@Composable
private fun WorkspaceCard(title: String, description: String, detail: String) {
    Surface(
        modifier = Modifier.fillMaxWidth().animateContentSize(),
        shape = RoundedCornerShape(19.dp),
        color = Color.White,
        border = BorderStroke(1.dp, DataCubeColors.Divider)
    ) {
        Column(Modifier.padding(17.dp)) {
            Text(title, fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
            Spacer(Modifier.height(7.dp))
            Text(description, color = DataCubeColors.TextSecondary)
            Spacer(Modifier.height(12.dp))
            HorizontalDivider(color = DataCubeColors.Divider)
            Spacer(Modifier.height(10.dp))
            Text(detail, color = DataCubeColors.TextSecondary, style = MaterialTheme.typography.bodySmall)
        }
    }
}
