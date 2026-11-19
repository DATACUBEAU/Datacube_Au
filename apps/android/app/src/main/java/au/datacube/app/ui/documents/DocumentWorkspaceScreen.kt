package au.datacube.app.ui.documents

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
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
import au.datacube.app.data.LocalDocument
import au.datacube.app.ui.theme.DataCubeColors

private val workspaceTabs = listOf("AU Chat", "Smart Note", "Prediction", "Practice", "Podcast")

@Composable
fun DocumentWorkspaceScreen(document: LocalDocument, onBack: () -> Unit) {
    var selectedTab by remember { mutableIntStateOf(0) }
    var smartNoteMode by remember { mutableIntStateOf(0) }
    var question by remember { mutableStateOf("") }

    Column(Modifier.fillMaxSize().background(DataCubeColors.BluePale)) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.Outlined.ArrowBack, "Back") }
            Icon(Icons.Outlined.Description, null, tint = DataCubeColors.Blue, modifier = Modifier.size(30.dp))
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(document.name, maxLines = 1, fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
                Text(document.extension.uppercase() + " · " + document.sizeBytes / 1024 + " KB", color = DataCubeColors.TextSecondary, style = MaterialTheme.typography.bodySmall)
            }
            IconButton(onClick = {}) { Icon(Icons.Outlined.MoreVert, "Document actions") }
            IconButton(onClick = {}) { Icon(Icons.Outlined.Settings, "Workspace settings") }
        }
        ScrollableTabRow(selectedTabIndex = selectedTab, edgePadding = 8.dp) {
            workspaceTabs.forEachIndexed { index, title ->
                Tab(selected = selectedTab == index, onClick = { selectedTab = index }, text = { Text(title) })
            }
        }
        when (selectedTab) {
            0 -> {
                Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(24.dp)) {
                        Icon(Icons.Outlined.ChatBubbleOutline, null, tint = DataCubeColors.Blue, modifier = Modifier.size(46.dp))
                        Spacer(Modifier.height(12.dp))
                        Text("Ask AU about this document", fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
                        Text("Document-grounded answers will appear here with page references.", color = DataCubeColors.TextSecondary)
                    }
                }
                Surface(color = Color.White, border = BorderStroke(1.dp, DataCubeColors.Divider)) {
                    Row(Modifier.fillMaxWidth().navigationBarsPadding().padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                        OutlinedTextField(value = question, onValueChange = { question = it }, modifier = Modifier.weight(1f), placeholder = { Text("Ask AU about this document…") }, maxLines = 3)
                        IconButton(onClick = { }) { Icon(Icons.Outlined.Send, "Send question", tint = DataCubeColors.Blue) }
                    }
                }
            }
            1 -> {
                Column(Modifier.fillMaxSize().padding(16.dp)) {
                    Text("Smart Note", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
                    Spacer(Modifier.height(12.dp))
                    SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                        SegmentedButton(selected = smartNoteMode == 0, onClick = { smartNoteMode = 0 }, shape = SegmentedButtonDefaults.itemShape(0, 2)) { Text("Diagram") }
                        SegmentedButton(selected = smartNoteMode == 1, onClick = { smartNoteMode = 1 }, shape = SegmentedButtonDefaults.itemShape(1, 2)) { Text("Notes") }
                    }
                    Spacer(Modifier.height(16.dp))
                    WorkspaceNotice(if (smartNoteMode == 0) "Concept diagram" else "Structured notes", "AI-generated notes and diagrams will be grounded in ${document.name}.")
                }
            }
            2 -> WorkspaceFeature("Prediction", "Generate likely questions, key topics and a focused study plan from this document.", "Generate Prediction")
            3 -> WorkspaceFeature("Practice", "Build a practice set from this document and your selected exam files.", "Start Practice")
            else -> WorkspaceFeature("Podcast", "Turn this document into an audio summary with chapters and playback controls.", "Generate Audio Summary")
        }
    }
}

@Composable
private fun WorkspaceFeature(title: String, description: String, action: String) {
    Column(Modifier.fillMaxSize().padding(18.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Spacer(Modifier.height(24.dp))
        Icon(Icons.Outlined.AutoAwesome, null, tint = DataCubeColors.Blue, modifier = Modifier.size(42.dp))
        Spacer(Modifier.height(12.dp))
        Text(title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
        Text(description, color = DataCubeColors.TextSecondary)
        Spacer(Modifier.height(24.dp))
        WorkspaceNotice("Cloud AI workflow", "This screen is ready for the authenticated DataCube cloud AI service. Generation remains disabled until its API contract is verified.")
        Spacer(Modifier.height(18.dp))
        Button(onClick = {}, enabled = false) { Text(action) }
    }
}

@Composable
private fun WorkspaceNotice(title: String, description: String) {
    Surface(shape = RoundedCornerShape(18.dp), color = Color.White, border = BorderStroke(1.dp, DataCubeColors.Divider)) {
        Column(Modifier.fillMaxWidth().padding(18.dp)) {
            Text(title, fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
            Spacer(Modifier.height(6.dp))
            Text(description, color = DataCubeColors.TextSecondary)
        }
    }
}
