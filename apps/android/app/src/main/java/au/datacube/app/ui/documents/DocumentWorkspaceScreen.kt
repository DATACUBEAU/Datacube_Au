package au.datacube.app.ui.documents

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
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

private val workspaceTabs = listOf("AU Chat", "Smart Note", "Prediction", "Practice", "Podcast")

@Composable
fun DocumentWorkspaceScreen(document: LocalDocument, onBack: () -> Unit) {
    var selectedTab by remember(document.id) { mutableIntStateOf(0) }
    var smartNoteMode by remember(document.id) { mutableIntStateOf(0) }
    var question by remember(document.id) { mutableStateOf("") }

    Column(Modifier.fillMaxSize().background(DataCubeColors.BluePale)) {
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
            IconButton(onClick = {}) { Icon(Icons.Outlined.MoreVert, "Document actions") }
        }
        ScrollableTabRow(selectedTabIndex = selectedTab, edgePadding = 8.dp, containerColor = Color.White) {
            workspaceTabs.forEachIndexed { index, title ->
                Tab(
                    selected = selectedTab == index,
                    onClick = { selectedTab = index },
                    text = { Text(title, maxLines = 1) },
                    icon = {
                        when (index) {
                            0 -> Icon(Icons.Outlined.ChatBubbleOutline, null)
                            1 -> Icon(Icons.Outlined.Notes, null)
                            2 -> Icon(Icons.Outlined.BarChart, null)
                            3 -> Icon(Icons.Outlined.Layers, null)
                            else -> Icon(Icons.Outlined.Headphones, null)
                        }
                    }
                )
            }
        }
        when (selectedTab) {
            0 -> {
                Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(26.dp)) {
                        Surface(shape = RoundedCornerShape(18.dp), color = DataCubeColors.BlueLight) {
                            Icon(Icons.Outlined.ChatBubbleOutline, null, tint = DataCubeColors.Blue, modifier = Modifier.padding(16.dp).size(36.dp))
                        }
                        Spacer(Modifier.height(12.dp))
                        Text("Ask AU about this document", fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
                        Text("Questions and cited answers will appear here.", color = DataCubeColors.TextSecondary)
                        Spacer(Modifier.height(5.dp))
                        Text(document.name, color = DataCubeColors.Blue, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
                Surface(color = Color.White, border = BorderStroke(1.dp, DataCubeColors.Divider)) {
                    Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(10.dp)) {
                        OutlinedTextField(
                            value = question,
                            onValueChange = { question = it },
                            modifier = Modifier.fillMaxWidth(),
                            placeholder = { Text("Ask anything about this document…") },
                            maxLines = 3,
                            shape = RoundedCornerShape(18.dp)
                        )
                        Spacer(Modifier.height(6.dp))
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("Cloud AI will be connected in a later phase.", color = DataCubeColors.TextSecondary, style = MaterialTheme.typography.labelSmall, modifier = Modifier.weight(1f))
                            FilledIconButton(onClick = {}, enabled = false) { Icon(Icons.Outlined.Send, "Send question") }
                        }
                    }
                }
            }
            1 -> {
                Column(Modifier.fillMaxSize().padding(16.dp)) {
                    Text("Smart Note", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
                    Spacer(Modifier.height(12.dp))
                    SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                        SegmentedButton(selected = smartNoteMode == 0, onClick = { smartNoteMode = 0 }, shape = SegmentedButtonDefaults.itemShape(0, 2)) { Icon(Icons.Outlined.AccountTree, null); Spacer(Modifier.width(6.dp)); Text("Diagram") }
                        SegmentedButton(selected = smartNoteMode == 1, onClick = { smartNoteMode = 1 }, shape = SegmentedButtonDefaults.itemShape(1, 2)) { Icon(Icons.Outlined.Notes, null); Spacer(Modifier.width(6.dp)); Text("Notes") }
                    }
                    Spacer(Modifier.height(14.dp))
                    WorkspaceCard(
                        title = if (smartNoteMode == 0) "Concept diagram" else "Structured notes",
                        description = if (smartNoteMode == 0) "A visual map of the main ideas and how they connect." else "Clear headings, key takeaways and a concise summary.",
                        detail = "This workspace is ready for the document intelligence connection."
                    )
                }
            }
            2 -> WorkspaceFeature("Prediction", "Likely questions, key topics and a focused study plan.", "Generate Prediction", Icons.Outlined.BarChart)
            3 -> WorkspaceFeature("Practice", "Practice questions based on this document and selected exam files.", "Start Practice", Icons.Outlined.Layers)
            else -> WorkspaceFeature("Podcast", "An audio summary with chapters and playback controls.", "Generate Audio Summary", Icons.Outlined.Headphones)
        }
    }
}

@Composable
private fun WorkspaceFeature(title: String, description: String, action: String, icon: androidx.compose.ui.graphics.vector.ImageVector) {
    Column(Modifier.fillMaxSize().padding(18.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Spacer(Modifier.height(20.dp))
        Surface(shape = RoundedCornerShape(20.dp), color = DataCubeColors.BlueLight) {
            Icon(icon, null, tint = DataCubeColors.Blue, modifier = Modifier.padding(17.dp).size(36.dp))
        }
        Spacer(Modifier.height(12.dp))
        Text(title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
        Text(description, color = DataCubeColors.TextSecondary)
        Spacer(Modifier.height(20.dp))
        WorkspaceCard(title = "Ready for the next phase", description = "The interface is prepared. Cloud AI processing will be connected after the UI and UX review.", detail = "Selected document: ${documentPlaceholder(title)}")
        Spacer(Modifier.height(16.dp))
        Button(onClick = {}, enabled = false, modifier = Modifier.fillMaxWidth()) { Text(action) }
    }
}

private fun documentPlaceholder(title: String) = title

@Composable
private fun WorkspaceCard(title: String, description: String, detail: String) {
    Surface(
        modifier = Modifier.fillMaxWidth().animateContentSize(),
        shape = RoundedCornerShape(20.dp),
        color = Color.White,
        border = BorderStroke(1.dp, DataCubeColors.Divider)
    ) {
        Column(Modifier.padding(18.dp)) {
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
