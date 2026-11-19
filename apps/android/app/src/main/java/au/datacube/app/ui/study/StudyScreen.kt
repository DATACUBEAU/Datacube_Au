package au.datacube.app.ui.study

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
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
import au.datacube.app.data.LocalDocumentProcessing
import au.datacube.app.data.LocalJobStatus
import au.datacube.app.ui.theme.DataCubeColors
import au.datacube.app.ui.theme.dataCubeBackdrop

private data class StudyTool(
    val name: String,
    val description: String,
    val tabIndex: Int,
    val icon: androidx.compose.ui.graphics.vector.ImageVector
)

private val studyTools = listOf(
    StudyTool("Smart Note", "Review structured notes and a concept map.", 1, Icons.Outlined.Notes),
    StudyTool("Prediction", "Create revision topics and study prompts.", 2, Icons.Outlined.BarChart),
    StudyTool("Practice", "Answer questions and check source passages.", 3, Icons.Outlined.Layers),
    StudyTool("Podcast", "Listen to document passages with text-to-speech.", 4, Icons.Outlined.Headphones)
)

@Composable
fun StudyScreen(
    modifier: Modifier = Modifier,
    documents: List<LocalDocumentProcessing>,
    onOpenDocument: (String, Int) -> Unit,
    onImport: () -> Unit
) {
    var selectedTool by remember { mutableIntStateOf(2) }

    LazyColumn(
        modifier = modifier.fillMaxSize().dataCubeBackdrop(),
        contentPadding = PaddingValues(horizontal = 18.dp, vertical = 18.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        item {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("Study Space", style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
                Text("Choose a tool and open one of your documents to begin.", color = DataCubeColors.TextSecondary)
            }
        }
        item {
            Text("Study tools", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
            Spacer(Modifier.height(8.dp))
            studyTools.chunked(2).forEach { rowTools ->
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
                    rowTools.forEach { tool ->
                        val selected = selectedTool == tool.tabIndex
                        Surface(
                            onClick = { selectedTool = tool.tabIndex },
                            modifier = Modifier.weight(1f),
                            shape = RoundedCornerShape(17.dp),
                            color = if (selected) DataCubeColors.BlueLight else Color.White,
                            border = BorderStroke(1.dp, if (selected) DataCubeColors.Blue else DataCubeColors.Divider)
                        ) {
                            Column(Modifier.padding(13.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                Icon(tool.icon, contentDescription = null, tint = DataCubeColors.Blue, modifier = Modifier.size(25.dp))
                                Text(tool.name, fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
                                Text(tool.description, style = MaterialTheme.typography.bodySmall, color = DataCubeColors.TextSecondary, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            }
                        }
                    }
                    if (rowTools.size == 1) Spacer(Modifier.weight(1f))
                }
            }
        }
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Select a document", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
                Spacer(Modifier.weight(1f))
                Text(documents.size.toString() + " files", color = DataCubeColors.TextSecondary, style = MaterialTheme.typography.bodySmall)
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
                        Icon(Icons.Outlined.School, contentDescription = null, tint = DataCubeColors.Blue, modifier = Modifier.size(42.dp))
                        Text("Your study library is empty", fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
                        Text("Upload a PDF or text document. Study tools become available after local text extraction completes.", color = DataCubeColors.TextSecondary)
                        Button(onClick = onImport) { Icon(Icons.Outlined.Add, contentDescription = null); Spacer(Modifier.width(6.dp)); Text("Upload documents") }
                    }
                }
            }
        } else {
            items(documents, key = { it.document.id }) { processing ->
                val document = processing.document
                val status = when (processing.extractionStatus) {
                    LocalJobStatus.QUEUED, LocalJobStatus.RETRYABLE -> "Waiting for local extraction"
                    LocalJobStatus.RUNNING -> "Extracting on this device"
                    LocalJobStatus.COMPLETED -> "Ready for study"
                    LocalJobStatus.FAILED -> "Text extraction failed"
                    LocalJobStatus.CANCELLED -> "Extraction cancelled"
                    else -> "Imported"
                }
                Surface(
                    onClick = { onOpenDocument(document.id, selectedTool) },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(17.dp),
                    color = Color.White,
                    border = BorderStroke(1.dp, DataCubeColors.Divider)
                ) {
                    Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                        Surface(shape = RoundedCornerShape(12.dp), color = DataCubeColors.BlueLight) {
                            Icon(Icons.Outlined.Description, contentDescription = null, tint = DataCubeColors.Blue, modifier = Modifier.padding(10.dp).size(25.dp))
                        }
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(document.name, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, color = DataCubeColors.Navy)
                            Text(status, style = MaterialTheme.typography.bodySmall, color = DataCubeColors.TextSecondary)
                        }
                        Icon(Icons.Outlined.ChevronRight, contentDescription = "Open selected study tool", tint = DataCubeColors.Blue)
                    }
                }
            }
        }
    }
}
