package au.datacube.app.ui.documents

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import au.datacube.app.data.LocalCollectionWithCount
import au.datacube.app.data.LocalDocumentProcessing
import au.datacube.app.data.LocalJobStatus
import au.datacube.app.ui.theme.DataCubeColors

@Composable
fun DocumentsScreen(
    modifier: Modifier = Modifier,
    documents: List<LocalDocumentProcessing>,
    collections: List<LocalCollectionWithCount>,
    onImport: () -> Unit,
    onCreateCollection: (String, (Result<String>) -> Unit) -> Unit,
    onOpenCollection: (String) -> Unit,
    onDeleteCollection: (String) -> Unit,
    onOpenDocument: (String) -> Unit,
    onDelete: (String) -> Unit
) {
    var createDialog by remember { mutableStateOf(false) }
    var collectionName by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var deleteCollection by remember { mutableStateOf<String?>(null) }

    if (createDialog) AlertDialog(
        onDismissRequest = { createDialog = false },
        title = { Text("Create Collection") },
        text = {
            Column {
                OutlinedTextField(value = collectionName, onValueChange = { collectionName = it; error = null }, label = { Text("Collection name") }, singleLine = true)
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = {
            TextButton(onClick = {
                onCreateCollection(collectionName) { result ->
                    result.onSuccess { collectionName = ""; createDialog = false }
                        .onFailure { error = it.message ?: "Unable to create collection." }
                }
            }) { Text("Create") }
        },
        dismissButton = { TextButton(onClick = { createDialog = false }) { Text("Cancel") } }
    )
    deleteCollection?.let { id ->
        AlertDialog(onDismissRequest = { deleteCollection = null }, title = { Text("Delete collection?") },
            text = { Text("Documents remain in your library; only this collection grouping is deleted.") },
            confirmButton = { TextButton(onClick = { onDeleteCollection(id); deleteCollection = null }) { Text("Delete") } },
            dismissButton = { TextButton(onClick = { deleteCollection = null }) { Text("Cancel") } })
    }

    Column(modifier.fillMaxSize().background(DataCubeColors.BluePale)) {
        LazyColumn(contentPadding = PaddingValues(18.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            item {
                Column {
                    Text("Documents", style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
                    Text("Upload files or create collections to organize your documents.", color = DataCubeColors.TextSecondary)
                }
            }
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Button(onClick = onImport, modifier = Modifier.weight(1f).height(76.dp), shape = RoundedCornerShape(16.dp)) {
                        Icon(Icons.Outlined.AddCircle, null); Spacer(Modifier.width(7.dp))
                        Column { Text("Upload Documents", fontWeight = FontWeight.Bold); Text("Add one or more files", style = MaterialTheme.typography.labelSmall) }
                    }
                    OutlinedButton(onClick = { createDialog = true }, modifier = Modifier.weight(1f).height(76.dp), shape = RoundedCornerShape(16.dp)) {
                        Icon(Icons.Outlined.CreateNewFolder, null, tint = DataCubeColors.Blue); Spacer(Modifier.width(7.dp))
                        Column { Text("Create Collection", fontWeight = FontWeight.Bold); Text("Group related files", style = MaterialTheme.typography.labelSmall) }
                    }
                }
            }
            item {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Collections", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
                    Spacer(Modifier.weight(1f))
                    TextButton(onClick = { createDialog = true }) { Text("Create") }
                }
                if (collections.isEmpty()) {
                    Surface(shape = RoundedCornerShape(18.dp), color = Color.White, border = BorderStroke(1.dp, DataCubeColors.Divider)) {
                        Column(Modifier.fillMaxWidth().padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                            Icon(Icons.Outlined.FolderOpen, null, tint = DataCubeColors.Blue, modifier = Modifier.size(40.dp))
                            Text("No collections yet", fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
                            Text("Create a collection to organize multiple documents.", color = DataCubeColors.TextSecondary)
                            OutlinedButton(onClick = { createDialog = true }) { Icon(Icons.Outlined.Add, null); Text(" Create Collection") }
                        }
                    }
                } else collections.forEach { collection ->
                    Surface(modifier = Modifier.fillMaxWidth().clickable { onOpenCollection(collection.id) }, shape = RoundedCornerShape(16.dp), color = Color.White, border = BorderStroke(1.dp, DataCubeColors.Divider)) {
                        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Outlined.Folder, null, tint = DataCubeColors.Blue, modifier = Modifier.size(32.dp))
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text(collection.name, fontWeight = FontWeight.SemiBold, color = DataCubeColors.Navy)
                                Text("${collection.documentCount} documents", color = DataCubeColors.TextSecondary, style = MaterialTheme.typography.bodySmall)
                            }
                            IconButton(onClick = { deleteCollection = collection.id }) { Icon(Icons.Outlined.MoreVert, "Collection actions") }
                        }
                    }
                }
            }
            item { Text("Recent Documents", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = DataCubeColors.Navy) }
            if (documents.isEmpty()) item {
                Surface(shape = RoundedCornerShape(16.dp), color = Color.White, border = BorderStroke(1.dp, DataCubeColors.Divider)) {
                    Column(Modifier.fillMaxWidth().padding(22.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("Your documents will appear here", color = DataCubeColors.TextSecondary)
                        Button(onClick = onImport) { Text("Upload a document") }
                    }
                }
            } else documents.forEach { item ->
                val d = item.document
                val ext = d.extension.lowercase()
                val tint = when (ext) { "pdf" -> Color(0xFFE5484D); "docx" -> DataCubeColors.Blue; else -> Color(0xFF20A866) }
                val status = when (item.extractionStatus) {
                    LocalJobStatus.QUEUED, LocalJobStatus.RETRYABLE -> "Processing queued"
                    LocalJobStatus.RUNNING -> "Processing…"
                    LocalJobStatus.COMPLETED -> "Ready"
                    LocalJobStatus.FAILED -> item.extractionError ?: "Processing failed"
                    LocalJobStatus.CANCELLED -> "Cancelled"
                    else -> "Imported"
                }
                item {
                    Surface(modifier = Modifier.fillMaxWidth().clickable { onOpenDocument(d.id) }, shape = RoundedCornerShape(16.dp), color = Color.White, border = BorderStroke(1.dp, DataCubeColors.Divider)) {
                        Row(Modifier.padding(13.dp), verticalAlignment = Alignment.CenterVertically) {
                            Box(Modifier.size(48.dp).background(tint.copy(alpha = .12f), RoundedCornerShape(13.dp)), contentAlignment = Alignment.Center) { Text(ext.uppercase().take(3), color = tint, fontWeight = FontWeight.Bold) }
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text(d.name, fontWeight = FontWeight.SemiBold, color = DataCubeColors.Navy, maxLines = 1)
                                Text("$status • ${d.sizeBytes / 1024} KB", style = MaterialTheme.typography.bodySmall, color = DataCubeColors.TextSecondary)
                            }
                            IconButton(onClick = { onDelete(d.id) }) { Icon(Icons.Outlined.DeleteOutline, "Delete document") }
                        }
                    }
                }
            }
        }
    }
}
