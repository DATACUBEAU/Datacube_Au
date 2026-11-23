package au.datacube.app.ui.documents

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
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
import androidx.compose.ui.zIndex
import au.datacube.app.ui.common.WorkspaceTopBar
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import au.datacube.app.data.LocalCollectionWithCount
import au.datacube.app.data.LocalDocumentProcessing
import au.datacube.app.data.LocalJobStatus
import au.datacube.app.ui.theme.DataCubeColors
import au.datacube.app.ui.theme.dataCubeBackdrop

@Composable
fun DocumentsScreen(
    modifier: Modifier = Modifier,
    documents: List<LocalDocumentProcessing>,
    collections: List<LocalCollectionWithCount>,
    onImport: () -> Unit,
    onNavigateHome: () -> Unit,
    onNavigateSettings: () -> Unit,
    onCreateCollection: (String, (Result<String>) -> Unit) -> Unit,
    onOpenCollection: (String) -> Unit,
    onDeleteCollection: (String) -> Unit,
    onOpenDocument: (String) -> Unit,
    onDelete: (String) -> Unit
) {
    var createDialog by remember { mutableStateOf(false) }
    var collectionName by remember { mutableStateOf("") }
    var creating by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var deleteCollection by remember { mutableStateOf<String?>(null) }
    var deleteDocument by remember { mutableStateOf<String?>(null) }

    if (createDialog) {
        AlertDialog(
            onDismissRequest = { if (!creating) createDialog = false },
            title = { Text("Create Collection") },
            text = {
                Column {
                    OutlinedTextField(
                        value = collectionName,
                        onValueChange = { value -> if (value.length <= 60) collectionName = value; error = null },
                        label = { Text("Collection name") },
                        singleLine = true,
                        enabled = !creating,
                        isError = error != null,
                        supportingText = { Text("${collectionName.length}/60") }
                    )
                    error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
                }
            },
            confirmButton = {
                TextButton(enabled = collectionName.isNotBlank() && !creating, onClick = {
                    creating = true
                    onCreateCollection(collectionName) { result ->
                        result.onSuccess { id -> collectionName = ""; error = null; creating = false; createDialog = false; onOpenCollection(id) }
                            .onFailure { error = it.message ?: "Unable to create collection."; creating = false }
                    }
                }) { if (creating) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Text("Create") }
            },
            dismissButton = { TextButton(enabled = !creating, onClick = { createDialog = false }) { Text("Cancel") } }
        )
    }
    deleteCollection?.let { id ->
        AlertDialog(
            onDismissRequest = { deleteCollection = null },
            title = { Text("Delete collection?") },
            text = { Text("Documents remain in your library; only this collection grouping is deleted.") },
            confirmButton = { TextButton(onClick = { onDeleteCollection(id); deleteCollection = null }) { Text("Delete") } },
            dismissButton = { TextButton(onClick = { deleteCollection = null }) { Text("Cancel") } }
        )
    }

    deleteDocument?.let { id ->
        val target = documents.firstOrNull { it.document.id == id }?.document
        AlertDialog(
            onDismissRequest = { deleteDocument = null },
            title = { Text("Delete document?") },
            text = {
                Text(
                    (target?.name ?: "This document") +
                        " and its locally stored extracted text will be removed from this device. This cannot be undone."
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    onDelete(id)
                    deleteDocument = null
                }) { Text("Delete") }
            },
            dismissButton = {
                TextButton(onClick = { deleteDocument = null }) { Text("Cancel") }
            }
        )
    }

    Box(modifier.fillMaxSize()) {
    LazyColumn(
        modifier = Modifier.fillMaxSize().dataCubeBackdrop(),
        contentPadding = PaddingValues(start = 18.dp, top = 104.dp, end = 18.dp, bottom = 18.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        item {
            Column {
                Text("Documents", style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
                Text("Upload files or create collections to organize your documents.", color = DataCubeColors.TextSecondary)
            }
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Button(onClick = onImport, modifier = Modifier.weight(1f).heightIn(min = 76.dp), shape = RoundedCornerShape(16.dp), contentPadding = PaddingValues(10.dp)) {
                    Icon(Icons.Outlined.AddCircle, null)
                    Spacer(Modifier.width(7.dp))
                    Column { Text("Upload Documents", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis); Text("Add one or more files", style = MaterialTheme.typography.labelSmall, maxLines = 2, overflow = TextOverflow.Ellipsis) }
                }
                OutlinedButton(onClick = { createDialog = true }, modifier = Modifier.weight(1f).heightIn(min = 76.dp), shape = RoundedCornerShape(16.dp), contentPadding = PaddingValues(10.dp)) {
                    Icon(Icons.Outlined.CreateNewFolder, null, tint = DataCubeColors.Blue)
                    Spacer(Modifier.width(7.dp))
                    Column { Text("Create Collection", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis); Text("Group related files", style = MaterialTheme.typography.labelSmall, maxLines = 2, overflow = TextOverflow.Ellipsis) }
                }
            }
        }
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Collections", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
                Spacer(Modifier.weight(1f))
                TextButton(onClick = { createDialog = true }) { Text("Create") }
            }
        }
        if (collections.isEmpty()) {
            item {
                Surface(shape = RoundedCornerShape(18.dp), color = Color.White, border = BorderStroke(1.dp, DataCubeColors.Divider)) {
                    Column(Modifier.fillMaxWidth().padding(22.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(Icons.Outlined.FolderOpen, null, tint = DataCubeColors.Blue, modifier = Modifier.size(40.dp))
                        Text("No collections yet", fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
                        Text("Create a collection to organize multiple documents.", color = DataCubeColors.TextSecondary)
                        Spacer(Modifier.height(10.dp))
                        OutlinedButton(onClick = { createDialog = true }) { Icon(Icons.Outlined.Add, null); Text(" Create Collection") }
                    }
                }
            }
        } else {
            items(collections, key = { it.id }) { collection ->
                Surface(
                    modifier = Modifier.fillMaxWidth().animateContentSize().clickable { onOpenCollection(collection.id) },
                    shape = RoundedCornerShape(17.dp), color = Color.White, border = BorderStroke(1.dp, DataCubeColors.Divider)
                ) {
                    Row(Modifier.padding(15.dp), verticalAlignment = Alignment.CenterVertically) {
                        Surface(shape = RoundedCornerShape(13.dp), color = DataCubeColors.BlueLight) {
                            Icon(Icons.Outlined.Folder, null, tint = DataCubeColors.Blue, modifier = Modifier.padding(9.dp).size(26.dp))
                        }
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(collection.name, fontWeight = FontWeight.SemiBold, color = DataCubeColors.Navy, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text("${collection.documentCount} documents", color = DataCubeColors.TextSecondary, style = MaterialTheme.typography.bodySmall)
                        }
                        IconButton(onClick = { deleteCollection = collection.id }) { Icon(Icons.Outlined.MoreVert, "Collection actions") }
                    }
                }
            }
        }
        item { Text("Recent Documents", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = DataCubeColors.Navy) }
        if (documents.isEmpty()) {
            item {
                Surface(shape = RoundedCornerShape(16.dp), color = Color.White, border = BorderStroke(1.dp, DataCubeColors.Divider)) {
                    Column(Modifier.fillMaxWidth().padding(22.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(Icons.Outlined.Description, null, tint = DataCubeColors.Blue, modifier = Modifier.size(36.dp))
                        Text("Your documents will appear here", color = DataCubeColors.TextSecondary)
                        Button(onClick = onImport) { Text("Upload a document") }
                    }
                }
            }
        } else {
            items(documents, key = { it.document.id }) { processing ->
                val document = processing.document
                val extension = document.extension.lowercase()
                val tint = DataCubeColors.Blue
                val status = when (processing.extractionStatus) {
                    LocalJobStatus.QUEUED, LocalJobStatus.RETRYABLE -> "Processing queued"
                    LocalJobStatus.RUNNING -> "Processing…"
                    LocalJobStatus.COMPLETED -> "Ready"
                    LocalJobStatus.FAILED -> processing.extractionError ?: "Processing failed"
                    LocalJobStatus.CANCELLED -> "Cancelled"
                    else -> "Imported"
                }
                Surface(
                    modifier = Modifier.fillMaxWidth().animateContentSize().clickable { onOpenDocument(document.id) },
                    shape = RoundedCornerShape(16.dp), color = Color.White, border = BorderStroke(1.dp, DataCubeColors.Divider)
                ) {
                    Row(Modifier.padding(13.dp), verticalAlignment = Alignment.CenterVertically) {
                        Surface(shape = RoundedCornerShape(13.dp), color = tint.copy(alpha = .12f)) {
                            Text(extension.uppercase().take(3), color = tint, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 9.dp, vertical = 13.dp))
                        }
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(document.name, fontWeight = FontWeight.SemiBold, color = DataCubeColors.Navy, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text("$status  ·  ${document.sizeBytes / 1024} KB", style = MaterialTheme.typography.bodySmall, color = DataCubeColors.TextSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                        IconButton(onClick = { deleteDocument = document.id }) { Icon(Icons.Outlined.DeleteOutline, "Delete document") }
                    }
                }
            }
        }
    }
    WorkspaceTopBar(
        documentSelected = true,
        onHome = onNavigateHome,
        onDocuments = {},
        onSettings = onNavigateSettings,
        modifier = Modifier.align(Alignment.TopCenter).zIndex(2f)
            .padding(horizontal = 18.dp, vertical = 10.dp)
    )
    }
}
