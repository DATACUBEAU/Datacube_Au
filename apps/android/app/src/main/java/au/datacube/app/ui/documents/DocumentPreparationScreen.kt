package au.datacube.app.ui.documents

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowBack
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.HourglassTop
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import au.datacube.app.data.LocalJobStatus
import au.datacube.app.ui.theme.dataCubeBackdrop

/**
 * The workspace opens automatically when local extraction reaches COMPLETED.
 * Never waits for optional embedding/model downloads.
 */
@Composable
fun DocumentPreparationScreen(
    documentName: String,
    extractionStatus: String?,
    extractionProgress: Double?,
    onBack: () -> Unit
) {
    val fraction = (extractionProgress ?: 0.0).toFloat().coerceIn(0f, 1f)
    val animated by animateFloatAsState(fraction, label = "document extraction progress")
    val isRunning = extractionStatus == LocalJobStatus.RUNNING
    val isQueued = extractionStatus == null || extractionStatus == LocalJobStatus.QUEUED ||
        extractionStatus == LocalJobStatus.RETRYABLE
    Column(
        Modifier.fillMaxSize().dataCubeBackdrop().padding(horizontal = 18.dp),
        verticalArrangement = Arrangement.spacedBy(22.dp)
    ) {
        Row(Modifier.fillMaxWidth().padding(top = 14.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) {
                Icon(Icons.Outlined.ArrowBack, "Back to documents")
            }
            Text("Preparing document", style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold)
        }
        Spacer(Modifier.height(8.dp))
        Surface(
            color = MaterialTheme.colorScheme.surface,
            shape = RoundedCornerShape(26.dp),
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
            tonalElevation = 2.dp
        ) {
            Column(Modifier.fillMaxWidth().padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Icon(Icons.Outlined.Description, null, Modifier.size(48.dp),
                    tint = MaterialTheme.colorScheme.primary)
                Text(documentName, fontWeight = FontWeight.Bold,
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurface)
                Text(
                    if (isRunning) "Extracting searchable text from your document"
                    else "Waiting for on-device processing to begin",
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                if (isQueued) {
                    LinearProgressIndicator(Modifier.fillMaxWidth())
                } else {
                    LinearProgressIndicator(
                        progress = { animated.coerceIn(0f, 1f) },
                        modifier = Modifier.fillMaxWidth()
                    )
                    Text("${(animated * 100).toInt()}% extracted",
                        color = MaterialTheme.colorScheme.primary,
                        style = MaterialTheme.typography.labelLarge)
                }
                HorizontalDivider()
                PreparationStage(
                    title = "Saved on your device",
                    subtitle = "The document file is safely stored",
                    completed = true
                )
                PreparationStage(
                    title = "Reading and extracting pages",
                    subtitle = if (isRunning) "Processing text page by page"
                        else "Queued for background extraction",
                    completed = false
                )
                PreparationStage(
                    title = "Ready for your study workspace",
                    subtitle = "AU Chat, Smart Notes and study tools unlock when extraction finishes",
                    completed = false
                )
            }
        }
        Text(
            "You can leave this screen. Document processing continues independently in the background. Your workspace opens after text extraction finishes.",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodyMedium
        )
        OutlinedButton(onClick = onBack, modifier = Modifier.fillMaxWidth()) {
            Text("Return to documents")
        }
    }
}

@Composable
private fun PreparationStage(title: String, subtitle: String, completed: Boolean) {
    Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Icon(if (completed) Icons.Outlined.CheckCircle else Icons.Outlined.HourglassTop,
            contentDescription = null, tint = if (completed) MaterialTheme.colorScheme.primary
                else MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(23.dp))
        Column {
            Text(title, fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurface)
            Text(subtitle, style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
