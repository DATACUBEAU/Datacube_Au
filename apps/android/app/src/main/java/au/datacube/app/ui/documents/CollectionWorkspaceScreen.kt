package au.datacube.app.ui.documents

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
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
import androidx.compose.ui.unit.dp
import au.datacube.app.data.LocalDocument
import au.datacube.app.ui.theme.DataCubeColors

@Composable
fun CollectionWorkspaceScreen(
    name: String,
    documents: List<LocalDocument>,
    onBack: () -> Unit,
    onAddDocuments: () -> Unit,
    onOpenDocument: (String) -> Unit
) {
    Column(Modifier.fillMaxSize().background(DataCubeColors.BluePale)) {
        Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.Outlined.ArrowBack, "Back") }
            Column(Modifier.weight(1f)) {
                Text(name, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
                Text("${documents.size} documents · Collection workspace", color = DataCubeColors.TextSecondary, style = MaterialTheme.typography.bodySmall)
            }
            IconButton(onClick = onAddDocuments) { Icon(Icons.Outlined.Add, "Add documents") }
        }
        Card(Modifier.fillMaxWidth().padding(horizontal = 16.dp), colors = CardDefaults.cardColors(containerColor = Color.White)) {
            Column(Modifier.padding(16.dp)) {
                Icon(Icons.Outlined.FolderOpen, null, tint = DataCubeColors.Blue, modifier = Modifier.size(30.dp))
                Spacer(Modifier.height(8.dp))
                Text("Ask across this collection", fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
                Text("AU can use the documents in this collection as a shared context for answers.", color = DataCubeColors.TextSecondary, style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.height(10.dp))
                OutlinedButton(onClick = onAddDocuments) { Icon(Icons.Outlined.Add, null); Text(" Add documents") }
            }
        }
        LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (documents.isEmpty()) item {
                Surface(shape = RoundedCornerShape(16.dp), color = Color.White, border = BorderStroke(1.dp, DataCubeColors.Divider)) {
                    Column(Modifier.fillMaxWidth().padding(22.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(Icons.Outlined.Description, null, tint = DataCubeColors.Blue, modifier = Modifier.size(36.dp))
                        Text("This collection is empty", fontWeight = FontWeight.SemiBold)
                        Text("Add multiple documents to build a shared study space.", color = DataCubeColors.TextSecondary)
                    }
                }
            }
            items(documents) { document ->
                Surface(onClick = { onOpenDocument(document.id) }, shape = RoundedCornerShape(14.dp), color = Color.White, border = BorderStroke(1.dp, DataCubeColors.Divider)) {
                    Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Outlined.Description, null, tint = DataCubeColors.Blue)
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(document.name, fontWeight = FontWeight.SemiBold, color = DataCubeColors.Navy)
                            Text(document.extension.uppercase() + " · " + document.sizeBytes / 1024 + " KB", color = DataCubeColors.TextSecondary, style = MaterialTheme.typography.bodySmall)
                        }
                        Icon(Icons.Outlined.ChevronRight, null, tint = DataCubeColors.TextSecondary)
                    }
                }
            }
        }
    }
}
