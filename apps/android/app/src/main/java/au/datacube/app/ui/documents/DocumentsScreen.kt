package au.datacube.app.ui.documents

import android.net.Uri
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import au.datacube.app.data.LocalDocumentProcessing
import au.datacube.app.data.LocalJobStatus

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DocumentsScreen(
    modifier: Modifier = Modifier,
    documents: List<LocalDocumentProcessing>,
    onImport: () -> Unit,
    onDelete: (String) -> Unit
) {
    var deleteTarget by remember { mutableStateOf<String?>(null) }

    // Delete confirmation dialog
    deleteTarget?.let { docId ->
        AlertDialog(
            onDismissRequest = { deleteTarget = null },
            icon = { Icon(Icons.Outlined.DeleteOutline, null) },
            title = { Text("Remove document?") },
            text = { Text("The document and its locally extracted text will be permanently deleted from this device.") },
            confirmButton = {
                TextButton(
                    onClick = { onDelete(docId); deleteTarget = null },
                    colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error)
                ) { Text("Delete") }
            },
            dismissButton = {
                TextButton(onClick = { deleteTarget = null }) { Text("Cancel") }
            }
        )
    }

    Scaffold(
        modifier = modifier,
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("My Documents", fontWeight = FontWeight.Bold)
                        Text(
                            "Stored privately on-device",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                },
                actions = {
                    FilledTonalIconButton(onClick = onImport) {
                        Icon(Icons.Outlined.Add, "Import document")
                    }
                }
            )
        }
    ) { padding ->
        if (documents.isEmpty()) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
                contentAlignment = Alignment.Center
            ) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    modifier = Modifier.padding(32.dp)
                ) {
                    Icon(
                        Icons.Outlined.FolderOpen,
                        null,
                        modifier = Modifier.size(64.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Spacer(Modifier.height(16.dp))
                    Text(
                        "No documents yet",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "Import PDF, DOCX, TXT, RTF or Markdown files.\nAll content is processed privately on this device.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Spacer(Modifier.height(24.dp))
                    Button(onClick = onImport) {
                        Icon(Icons.Outlined.Add, null)
                        Spacer(Modifier.width(8.dp))
                        Text("Import a document")
                    }
                }
            }
        } else {
            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
                contentPadding = PaddingValues(bottom = 16.dp)
            ) {
                items(documents, key = { it.document.id }) { item ->
                    val doc = item.document
                    val extractionLabel = when (item.extractionStatus) {
                        LocalJobStatus.QUEUED, LocalJobStatus.RETRYABLE -> "Extraction queued"
                        LocalJobStatus.RUNNING -> "Extracting text…"
                        LocalJobStatus.COMPLETED -> "Text ready"
                        LocalJobStatus.FAILED -> item.extractionError ?: "Extraction failed"
                        LocalJobStatus.CANCELLED -> "Extraction cancelled"
                        null -> if (doc.extension in setOf("txt", "md")) "Pending extraction" else "Format support coming"
                        else -> "Unknown"
                    }
                    val verificationLabel = if (doc.sha256 == null) "Integrity check pending" else "Verified on-device"

                    ListItem(
                        leadingContent = {
                            Icon(
                                when (doc.extension) {
                                    "pdf" -> Icons.Outlined.PictureAsPdf
                                    "docx" -> Icons.Outlined.Description
                                    else -> Icons.Outlined.Article
                                },
                                null,
                                tint = MaterialTheme.colorScheme.primary
                            )
                        },
                        headlineContent = { Text(doc.name, maxLines = 2, fontWeight = FontWeight.Medium) },
                        supportingContent = {
                            Column {
                                Text(
                                    "${doc.extension.uppercase()} · ${doc.sizeBytes / 1024} KB · $verificationLabel",
                                    style = MaterialTheme.typography.bodySmall
                                )
                                Text(
                                    extractionLabel,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = when (item.extractionStatus) {
                                        LocalJobStatus.COMPLETED -> MaterialTheme.colorScheme.primary
                                        LocalJobStatus.FAILED -> MaterialTheme.colorScheme.error
                                        else -> MaterialTheme.colorScheme.onSurfaceVariant
                                    }
                                )
                            }
                        },
                        trailingContent = {
                            IconButton(onClick = { deleteTarget = doc.id }) {
                                Icon(
                                    Icons.Outlined.DeleteOutline,
                                    "Delete",
                                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        }
                    )
                    HorizontalDivider()
                }
            }
        }
    }
}
