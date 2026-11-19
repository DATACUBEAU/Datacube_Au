package au.datacube.app.ui.home

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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import au.datacube.app.data.LocalDocumentProcessing
import au.datacube.app.ui.theme.DataCubeColors
import au.datacube.app.ui.theme.dataCubeBackdrop
import io.github.jan.supabase.auth.user.UserInfo

@Composable
fun HomeScreen(
    modifier: Modifier = Modifier,
    user: UserInfo?,
    recentDocuments: List<LocalDocumentProcessing>,
    onImportDocument: () -> Unit,
    onNavigateToDocuments: () -> Unit,
    onNavigateToStudy: () -> Unit,
    onNavigateToChat: () -> Unit,
    onOpenDocument: (String) -> Unit,
    onNavigateSettings: () -> Unit
) {
    LazyColumn(
        modifier = modifier.fillMaxSize().dataCubeBackdrop(),
        contentPadding = PaddingValues(horizontal = 20.dp, vertical = 18.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp)
    ) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                SingleChoiceSegmentedButtonRow(Modifier.weight(1f)) {
                    SegmentedButton(selected = true, onClick = {}, shape = SegmentedButtonDefaults.itemShape(0, 2)) { Text("AU") }
                    SegmentedButton(selected = false, onClick = onNavigateToDocuments, shape = SegmentedButtonDefaults.itemShape(1, 2)) { Text("Document") }
                }
                IconButton(onClick = onNavigateSettings) { Icon(Icons.Outlined.Settings, "Settings", tint = DataCubeColors.Navy) }
            }
        }
        item {
            Column {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("DataCube AU", style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
                        Text("Chat, analyze, and get insights from your documents.", color = DataCubeColors.TextSecondary, style = MaterialTheme.typography.bodyLarge)
                    }
                    Surface(shape = RoundedCornerShape(18.dp), color = DataCubeColors.BlueLight) {
                        Icon(Icons.Outlined.AutoAwesome, contentDescription = "DataCube AU", tint = DataCubeColors.Blue, modifier = Modifier.padding(14.dp).size(28.dp))
                    }
                }
                Spacer(Modifier.height(18.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Button(onClick = onNavigateToChat, modifier = Modifier.weight(1f).heightIn(min = 52.dp), shape = RoundedCornerShape(15.dp)) {
                        Icon(Icons.Outlined.ChatBubbleOutline, null); Spacer(Modifier.width(7.dp)); Text("AU Chat")
                    }
                    OutlinedButton(onClick = onNavigateToStudy, modifier = Modifier.weight(1f).heightIn(min = 52.dp), shape = RoundedCornerShape(15.dp)) {
                        Icon(Icons.Outlined.School, null); Spacer(Modifier.width(7.dp)); Text("Study")
                    }
                }
            }
        }
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Active Documents", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
                Spacer(Modifier.weight(1f))
                TextButton(onClick = onNavigateToDocuments) { Text("View All  →") }
            }
        }
        if (recentDocuments.isEmpty()) {
            item {
                Surface(shape = RoundedCornerShape(20.dp), color = Color.White, border = BorderStroke(1.dp, DataCubeColors.Divider)) {
                    Column(Modifier.fillMaxWidth().padding(22.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(Icons.Outlined.FolderOpen, null, tint = DataCubeColors.Blue, modifier = Modifier.size(42.dp))
                        Spacer(Modifier.height(8.dp))
                        Text("No documents yet", fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
                        Text("Upload a file to start exploring your documents.", color = DataCubeColors.TextSecondary)
                        Spacer(Modifier.height(12.dp))
                        Button(onClick = onImportDocument) { Icon(Icons.Outlined.Add, null); Text(" Upload Documents") }
                    }
                }
            }
        } else {
            items(recentDocuments.take(5), key = { it.document.id }) { entry ->
                val doc = entry.document
                val ext = doc.extension.lowercase()
                val tint = when (ext) { "pdf" -> Color(0xFFE5484D); "docx" -> DataCubeColors.Blue; else -> Color(0xFF20A866) }
                Surface(onClick = { onOpenDocument(doc.id) }, shape = RoundedCornerShape(17.dp), color = Color.White, border = BorderStroke(1.dp, DataCubeColors.Divider)) {
                    Row(Modifier.fillMaxWidth().padding(13.dp), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(48.dp).clip(RoundedCornerShape(14.dp)).background(tint.copy(alpha = .12f)), contentAlignment = Alignment.Center) {
                            Text(ext.uppercase().take(3), color = tint, fontWeight = FontWeight.Bold)
                        }
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(doc.name, fontWeight = FontWeight.SemiBold, color = DataCubeColors.Navy, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text("${ext.uppercase()}  ·  ${doc.sizeBytes / 1024} KB", style = MaterialTheme.typography.bodySmall, color = DataCubeColors.TextSecondary)
                        }
                        Icon(Icons.Outlined.ChevronRight, null, tint = DataCubeColors.TextSecondary)
                    }
                }
            }
        }
        item {
            Surface(shape = RoundedCornerShape(20.dp), color = Color.White, border = BorderStroke(1.dp, DataCubeColors.Divider)) {
                Column(Modifier.fillMaxWidth().padding(18.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Outlined.AutoAwesome, null, tint = DataCubeColors.Blue)
                        Spacer(Modifier.width(8.dp))
                        Text("Your study workspace", fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
                    }
                    Spacer(Modifier.height(6.dp))
                    Text("Keep your documents organized and open AU Chat whenever you are ready to explore them.", color = DataCubeColors.TextSecondary)
                    Spacer(Modifier.height(12.dp))
                    OutlinedButton(onClick = onNavigateToDocuments, modifier = Modifier.fillMaxWidth()) { Text("Open Documents") }
                }
            }
        }
    }
}
