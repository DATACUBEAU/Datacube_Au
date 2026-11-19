package au.datacube.app.ui.documents

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
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
    var questionCount by remember(document.id) { mutableStateOf("10 Questions") }
    var questionType by remember(document.id) { mutableStateOf("Mixed") }
    var focusArea by remember(document.id) { mutableStateOf("All Topics") }

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
                Tab(selected = selectedTab == index, onClick = { selectedTab = index }, text = { Text(title, maxLines = 1) }, icon = {
                    when (index) {
                        0 -> Icon(Icons.Outlined.ChatBubbleOutline, null)
                        1 -> Icon(Icons.Outlined.Notes, null)
                        2 -> Icon(Icons.Outlined.BarChart, null)
                        3 -> Icon(Icons.Outlined.Layers, null)
                        else -> Icon(Icons.Outlined.Headphones, null)
                    }
                })
            }
        }
        when (selectedTab) {
            0 -> ChatWorkspace(document.name, question, { question = it })
            1 -> SmartNoteWorkspace(document.name, smartNoteMode, { smartNoteMode = it })
            2 -> PredictionWorkspace(document.name)
            3 -> PracticeWorkspace(document.name, questionCount, { questionCount = it }, questionType, { questionType = it }, focusArea, { focusArea = it })
            else -> PodcastWorkspace(document.name)
        }
    }
}

@Composable
private fun ChatWorkspace(documentName: String, question: String, onQuestionChange: (String) -> Unit) {
    Column(Modifier.fillMaxSize()) {
        Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(26.dp)) {
                WorkspaceIcon(Icons.Outlined.ChatBubbleOutline)
                Spacer(Modifier.height(12.dp))
                Text("Ask AU about this document", fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
                Text("Questions and cited answers will appear here.", color = DataCubeColors.TextSecondary)
                Spacer(Modifier.height(5.dp))
                Text(documentName, color = DataCubeColors.Blue, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        Surface(color = Color.White, border = BorderStroke(1.dp, DataCubeColors.Divider)) {
            Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(10.dp)) {
                OutlinedTextField(value = question, onValueChange = onQuestionChange, modifier = Modifier.fillMaxWidth(), placeholder = { Text("Ask anything about this document…") }, maxLines = 3, shape = RoundedCornerShape(18.dp))
                Spacer(Modifier.height(6.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Cloud AI connection is planned for the next phase.", color = DataCubeColors.TextSecondary, style = MaterialTheme.typography.labelSmall, modifier = Modifier.weight(1f))
                    FilledIconButton(onClick = {}, enabled = false) { Icon(Icons.Outlined.Send, "Send question") }
                }
            }
        }
    }
}

@Composable
private fun SmartNoteWorkspace(documentName: String, mode: Int, onModeChange: (Int) -> Unit) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        Text("Smart Note", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
        Spacer(Modifier.height(12.dp))
        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
            SegmentedButton(selected = mode == 0, onClick = { onModeChange(0) }, shape = SegmentedButtonDefaults.itemShape(0, 2)) { Icon(Icons.Outlined.AccountTree, null); Spacer(Modifier.width(6.dp)); Text("Diagram") }
            SegmentedButton(selected = mode == 1, onClick = { onModeChange(1) }, shape = SegmentedButtonDefaults.itemShape(1, 2)) { Icon(Icons.Outlined.Notes, null); Spacer(Modifier.width(6.dp)); Text("Notes") }
        }
        Spacer(Modifier.height(14.dp))
        if (mode == 0) {
            WorkspaceCard("Concept map", "A structured visual map of the ideas in this document.", documentName)
            Spacer(Modifier.height(16.dp))
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                Surface(shape = RoundedCornerShape(16.dp), color = Color.White, border = BorderStroke(1.dp, DataCubeColors.Blue)) {
                    Text("Main topic", modifier = Modifier.padding(horizontal = 24.dp, vertical = 16.dp), fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
                }
            }
            Box(Modifier.fillMaxWidth().height(26.dp), contentAlignment = Alignment.Center) { Box(Modifier.width(1.dp).fillMaxHeight().background(DataCubeColors.Blue)) }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("Key idea 1", "Key idea 2", "Key idea 3").forEachIndexed { index, label ->
                    Surface(Modifier.weight(1f), shape = RoundedCornerShape(13.dp), color = if (index == 1) Color(0xFFE7F8F1) else DataCubeColors.BlueLight, border = BorderStroke(1.dp, DataCubeColors.Divider)) {
                        Text(label, modifier = Modifier.padding(vertical = 16.dp, horizontal = 5.dp), color = DataCubeColors.Navy, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
            Spacer(Modifier.height(14.dp))
            WorkspaceCard("Ready for generation", "The diagram structure follows your reference design. Document-grounded content will be populated when Cloud AI is enabled.", documentName)
        } else {
            WorkspaceCard("Key takeaway", "A concise summary of the most important idea in the document.", "Content will be generated from $documentName.")
            Spacer(Modifier.height(12.dp))
            listOf("1  Main concept", "2  Supporting ideas", "3  Examples and applications").forEach { heading ->
                Surface(Modifier.fillMaxWidth().padding(bottom = 9.dp), shape = RoundedCornerShape(15.dp), color = Color.White, border = BorderStroke(1.dp, DataCubeColors.Divider)) {
                    Column(Modifier.padding(15.dp)) {
                        Text(heading, fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
                        Spacer(Modifier.height(5.dp))
                        Text("Structured notes and highlighted key terms will appear here.", color = DataCubeColors.TextSecondary, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
            WorkspaceCard("Summary", "A short recap of the main points.", "Waiting for document intelligence.")
        }
    }
}

@Composable
private fun PredictionWorkspace(documentName: String) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            WorkspaceIcon(Icons.Outlined.BarChart)
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text("Prediction", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
                Text("Likely questions, key topics and a focused study plan.", color = DataCubeColors.TextSecondary, style = MaterialTheme.typography.bodySmall)
            }
        }
        Spacer(Modifier.height(16.dp))
        WorkspaceCard("Selected document", documentName, "Additional files can be included in a later step.")
        Spacer(Modifier.height(16.dp))
        Button(onClick = {}, enabled = false, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Outlined.AutoAwesome, null); Spacer(Modifier.width(8.dp)); Text("Generate Prediction") }
        Spacer(Modifier.height(18.dp))
        WorkspaceCard("Prediction results", "Your likely questions and key topics will appear here.", "Cloud AI connection is planned for the next phase.")
    }
}

@Composable
private fun PracticeWorkspace(
    documentName: String,
    questionCount: String, onQuestionCount: (String) -> Unit,
    questionType: String, onQuestionType: (String) -> Unit,
    focusArea: String, onFocusArea: (String) -> Unit
) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            WorkspaceIcon(Icons.Outlined.Layers)
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text("Practice", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
                Text("Test your understanding with practice questions.", color = DataCubeColors.TextSecondary, style = MaterialTheme.typography.bodySmall)
            }
        }
        Spacer(Modifier.height(16.dp))
        WorkspaceCard("Study document", documentName, "Exam files can be attached when practice generation is enabled.")
        Spacer(Modifier.height(16.dp))
        Text("Practice Setup", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
        Spacer(Modifier.height(10.dp))
        SelectionField("Question Count", questionCount, listOf("5 Questions", "10 Questions", "20 Questions"), onQuestionCount)
        SelectionField("Question Type", questionType, listOf("Mixed", "Multiple Choice", "Short Answer"), onQuestionType)
        SelectionField("Focus Area", focusArea, listOf("All Topics", "Key Concepts", "Difficult Topics"), onFocusArea)
        Spacer(Modifier.height(16.dp))
        Button(onClick = {}, enabled = false, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Outlined.PlayArrow, null); Spacer(Modifier.width(8.dp)); Text("Start Practice") }
        Text("Practice generation will be enabled with Cloud AI.", color = DataCubeColors.TextSecondary, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(top = 8.dp))
    }
}

@Composable
private fun SelectionField(label: String, value: String, options: List<String>, onSelect: (String) -> Unit) {
    var expanded by remember(label) { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().padding(bottom = 12.dp)) {
        Text(label, fontWeight = FontWeight.SemiBold, color = DataCubeColors.Navy)
        Spacer(Modifier.height(5.dp))
        Box {
            OutlinedButton(onClick = { expanded = true }, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(13.dp)) {
                Text(value, modifier = Modifier.weight(1f))
                Icon(Icons.Outlined.ExpandMore, null)
            }
            DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                options.forEach { option -> DropdownMenuItem(text = { Text(option) }, onClick = { onSelect(option); expanded = false }) }
            }
        }
    }
}

@Composable
private fun PodcastWorkspace(documentName: String) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            WorkspaceIcon(Icons.Outlined.Headphones)
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text("Podcast", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
                Text("Turn your notes into an audio summary.", color = DataCubeColors.TextSecondary, style = MaterialTheme.typography.bodySmall)
            }
        }
        Spacer(Modifier.height(16.dp))
        Surface(Modifier.fillMaxWidth().animateContentSize(), shape = RoundedCornerShape(22.dp), color = Color.White, border = BorderStroke(1.dp, DataCubeColors.Divider)) {
            Column(Modifier.padding(18.dp)) {
                Text("$documentName — Audio Summary", fontWeight = FontWeight.Bold, color = DataCubeColors.Navy, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text("Audio will appear here after generation.", color = DataCubeColors.TextSecondary, style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.height(16.dp))
                LinearProgressIndicator(progress = { 0f }, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(14.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly, verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = {}, enabled = false) { Icon(Icons.Outlined.Replay10, "Back 10 seconds") }
                    FilledIconButton(onClick = {}, enabled = false) { Icon(Icons.Outlined.PlayArrow, "Play") }
                    IconButton(onClick = {}, enabled = false) { Icon(Icons.Outlined.Forward10, "Forward 10 seconds") }
                }
                Button(onClick = {}, enabled = false, modifier = Modifier.fillMaxWidth()) { Text("Generate Audio Summary") }
            }
        }
        Spacer(Modifier.height(16.dp))
        WorkspaceCard("Chapters", "Your audio summary will be divided into clear sections.", "No chapters yet.")
    }
}

@Composable
private fun WorkspaceIcon(icon: androidx.compose.ui.graphics.vector.ImageVector) {
    Surface(shape = RoundedCornerShape(16.dp), color = DataCubeColors.BlueLight) {
        Icon(icon, null, tint = DataCubeColors.Blue, modifier = Modifier.padding(13.dp).size(28.dp))
    }
}

@Composable
private fun WorkspaceCard(title: String, description: String, detail: String) {
    Surface(
        modifier = Modifier.fillMaxWidth().animateContentSize(),
        shape = RoundedCornerShape(19.dp),
        color = Color.White,
        border = BorderStroke(1.dp, DataCubeColors.Divider)
    ) {
        Column(Modifier.padding(17.dp)) {
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
