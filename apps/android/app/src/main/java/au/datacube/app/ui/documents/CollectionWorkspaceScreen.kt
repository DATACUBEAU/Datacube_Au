package au.datacube.app.ui.documents

import androidx.compose.animation.animateContentSize
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
import au.datacube.app.data.LocalDocument
import au.datacube.app.ui.theme.DataCubeColors
import au.datacube.app.ui.theme.dataCubeBackdrop

@Composable
fun CollectionWorkspaceScreen(
    name: String,
    documents: List<LocalDocument>,
    onBack: () -> Unit,
    onAddDocuments: () -> Unit,
    onRemoveDocument: (String) -> Unit,
    onOpenDocument: (String) -> Unit
) {
    var removeDocumentId by remember { mutableStateOf<String?>(null) }

    removeDocumentId?.let { documentId ->
        val selectedDocument = documents.firstOrNull { it.id == documentId }
        AlertDialog(
            onDismissRequest = { removeDocumentId = null },
            title = { Text("Remove from collection?") },
            text = {
                Text("${selectedDocument?.name ?: "This document"} will stay in your library. Only its collection membership will be removed.")
            },
            confirmButton = {
                TextButton(onClick = {
                    onRemoveDocument(documentId)
                    removeDocumentId = null
                }) { Text("Remove") }
            },
            dismissButton = {
                TextButton(onClick = { removeDocumentId = null }) { Text("Cancel") }
            }
        )
    }

    Column(Modifier.fillMaxSize().dataCubeBackdrop()) {
        Row(Modifier.fillMaxWidth().padding(start = 8.dp, end = 12.dp, top = 8.dp, bottom = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.Outlined.ArrowBack, "Back to documents") }
            Column(Modifier.weight(1f)) {
                Text(name, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = DataCubeColors.Navy, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text("${documents.size} documents · Collection", color = DataCubeColors.TextSecondary, style = MaterialTheme.typography.bodySmall)
            }
            IconButton(onClick = onAddDocuments) { Icon(Icons.Outlined.Add, "Add documents", tint = DataCubeColors.Blue) }
        }

        LazyColumn(
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            item {
                Surface(
                    modifier = Modifier.fillMaxWidth().animateContentSize(),
                    shape = RoundedCornerShape(22.dp),
                    color = Color.White,
                    border = BorderStroke(1.dp, DataCubeColors.Divider)
                ) {
                    Column(Modifier.padding(18.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Surface(shape = RoundedCornerShape(13.dp), color = DataCubeColors.BlueLight) {
                                Icon(Icons.Outlined.FolderOpen, null, tint = DataCubeColors.Blue, modifier = Modifier.padding(10.dp).size(28.dp))
                            }
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text("Collection workspace", fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
                                Text("Your documents, organized in one place.", color = DataCubeColors.TextSecondary, style = MaterialTheme.typography.bodySmall)
                            }
                        }
                        Spacer(Modifier.height(16.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            OutlinedButton(onClick = onAddDocuments, modifier = Modifier.weight(1f)) {
                                Icon(Icons.Outlined.Add, null); Spacer(Modifier.width(6.dp)); Text("Add documents")
                            }
                            Surface(shape = RoundedCornerShape(12.dp), color = DataCubeColors.BluePale) {
                                Row(Modifier.padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Icon(Icons.Outlined.Description, null, tint = DataCubeColors.Blue, modifier = Modifier.size(17.dp))
                                    Spacer(Modifier.width(6.dp))
                                    Text("${documents.size}", color = DataCubeColors.Navy, fontWeight = FontWeight.SemiBold)
                                }
                            }
                        }
                    }
                }
            }
            item {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Documents", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
                    Spacer(Modifier.weight(1f))
                    Text("${documents.size} items", color = DataCubeColors.TextSecondary, style = MaterialTheme.typography.bodySmall)
                }
            }
            if (documents.isEmpty()) {
                item {
                    Surface(shape = RoundedCornerShape(20.dp), color = Color.White, border = BorderStroke(1.dp, DataCubeColors.Divider)) {
                        Column(Modifier.fillMaxWidth().padding(28.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                            Icon(Icons.Outlined.FolderOpen, null, tint = DataCubeColors.Blue, modifier = Modifier.size(44.dp))
                            Spacer(Modifier.height(10.dp))
                            Text("This collection is empty", fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
                            Text("Add several documents to build your collection workspace.", color = DataCubeColors.TextSecondary)
                            Spacer(Modifier.height(12.dp))
                            Button(onClick = onAddDocuments) { Icon(Icons.Outlined.Add, null); Text(" Add documents") }
                        }
                    }
                }
            } else {
                items(documents, key = { it.id }) { document ->
                    Surface(
                        onClick = { onOpenDocument(document.id) },
                        modifier = Modifier.fillMaxWidth().animateContentSize(),
                        shape = RoundedCornerShape(16.dp),
                        color = Color.White,
                        border = BorderStroke(1.dp, DataCubeColors.Divider)
                    ) {
                        Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                            Surface(shape = RoundedCornerShape(12.dp), color = DataCubeColors.BlueLight) {
                                Icon(Icons.Outlined.Description, null, tint = DataCubeColors.Blue, modifier = Modifier.padding(10.dp).size(24.dp))
                            }
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text(document.name, fontWeight = FontWeight.SemiBold, color = DataCubeColors.Navy, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text("${document.extension.uppercase()} · ${document.sizeBytes / 1024} KB", color = DataCubeColors.TextSecondary, style = MaterialTheme.typography.bodySmall)
                            }
                            IconButton(onClick = { removeDocumentId = document.id }) {
                                Icon(Icons.Outlined.RemoveCircleOutline, "Remove from collection", tint = DataCubeColors.TextSecondary)
                            }
                            Icon(Icons.Outlined.ChevronRight, null, tint = DataCubeColors.TextSecondary)
                        }
                    }
                }
            }
        }
    }
}
