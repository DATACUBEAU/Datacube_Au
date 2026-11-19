package au.datacube.app.ui.chat

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import au.datacube.app.data.LocalDocumentProcessing
import au.datacube.app.data.LocalJobStatus
import au.datacube.app.ui.theme.DataCubeColors
import au.datacube.app.ui.theme.dataCubeBackdrop

@Composable
fun ChatScreen(
    modifier: Modifier = Modifier,
    documents: List<LocalDocumentProcessing>,
    onOpenDocument: (String) -> Unit,
    onImport: () -> Unit
) {
    LazyColumn(
        modifier = modifier.fillMaxSize().dataCubeBackdrop(),
        contentPadding = PaddingValues(horizontal = 18.dp, vertical = 18.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        item {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("AU Chat", style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
                Text("Choose a document to start a source-grounded conversation.", color = DataCubeColors.TextSecondary)
            }
        }
        if (documents.isEmpty()) {
            item {
                Surface(
                    Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(20.dp),
                    color = Color.White,
                    border = BorderStroke(1.dp, DataCubeColors.Divider)
                ) {
                    Column(
                        Modifier.fillMaxWidth().padding(24.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        Icon(Icons.Outlined.ChatBubbleOutline, contentDescription = null, tint = DataCubeColors.Blue, modifier = Modifier.size(42.dp))
                        Text("No documents available", fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
                        Text("Import a document first. AU Chat will use its on-device extracted text and show matching page references.", color = DataCubeColors.TextSecondary)
                        Button(onClick = onImport) { Icon(Icons.Outlined.Add, contentDescription = null); Spacer(Modifier.width(6.dp)); Text("Upload documents") }
                    }
                }
            }
        } else {
            item {
                Text("Your documents", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
            }
            items(documents, key = { it.document.id }) { processing ->
                val document = processing.document
                val status = when (processing.extractionStatus) {
                    LocalJobStatus.QUEUED, LocalJobStatus.RETRYABLE -> "Extraction queued"
                    LocalJobStatus.RUNNING -> "Extracting on device"
                    LocalJobStatus.COMPLETED -> "Ready to search"
                    LocalJobStatus.FAILED -> "Extraction failed"
                    LocalJobStatus.CANCELLED -> "Extraction cancelled"
                    else -> "Imported"
                }
                Surface(
                    onClick = { onOpenDocument(document.id) },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(18.dp),
                    color = Color.White,
                    border = BorderStroke(1.dp, DataCubeColors.Divider)
                ) {
                    Row(
                        Modifier.fillMaxWidth().padding(14.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Surface(shape = RoundedCornerShape(13.dp), color = DataCubeColors.BlueLight) {
                            Icon(Icons.Outlined.Description, contentDescription = null, tint = DataCubeColors.Blue, modifier = Modifier.padding(11.dp).size(24.dp))
                        }
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(document.name, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.SemiBold, color = DataCubeColors.Navy)
                            Text(status, style = MaterialTheme.typography.bodySmall, color = DataCubeColors.TextSecondary)
                        }
                        Icon(Icons.Outlined.ChevronRight, contentDescription = "Open chat", tint = DataCubeColors.Blue)
                    }
                }
            }
        }
    }
}
