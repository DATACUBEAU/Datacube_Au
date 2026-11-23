package au.datacube.app.ui.home

import androidx.compose.foundation.BorderStroke
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.zIndex
import au.datacube.app.ui.common.WorkspaceTopBar
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
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
    onNavigateSettings: () -> Unit,
    onSendPromptToDocument: (String, String) -> Unit = { _, _ -> }
) {
    var quickPrompt by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf("") }
    val chatPress = androidx.compose.runtime.remember { MutableInteractionSource() }
    val chatPressed by chatPress.collectIsPressedAsState()
    val chatScale by animateFloatAsState(if (chatPressed) .97f else 1f, label = "AU Chat press")
    val studyPress = androidx.compose.runtime.remember { MutableInteractionSource() }
    val studyPressed by studyPress.collectIsPressedAsState()
    val studyScale by animateFloatAsState(if (studyPressed) .97f else 1f, label = "Study button press")
    var selectedDocumentId by androidx.compose.runtime.remember {
        androidx.compose.runtime.mutableStateOf<String?>(null)
    }
    var documentMenuExpanded by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf(false) }
    val selectedDocument = recentDocuments.firstOrNull { it.document.id == selectedDocumentId }
        ?: recentDocuments.firstOrNull()

    androidx.compose.runtime.LaunchedEffect(recentDocuments) {
        if (recentDocuments.none { it.document.id == selectedDocumentId }) {
            selectedDocumentId = recentDocuments.firstOrNull()?.document?.id
        }
    }

    Box(modifier.fillMaxSize()) {
    LazyColumn(
        modifier = Modifier.fillMaxSize().dataCubeBackdrop(),
        contentPadding = PaddingValues(start = 20.dp, top = 104.dp, end = 20.dp, bottom = 230.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp)
    ) {
        item {
            Surface(
                shape = RoundedCornerShape(26.dp),
                color = DataCubeColors.Navy,
                border = BorderStroke(1.dp, Color(0xFF35608B)),
                shadowElevation = 6.dp
            ) {
                Box(Modifier.fillMaxWidth()) {
                    StudyScene(Modifier.matchParentSize())
                    Column(Modifier.fillMaxWidth().padding(20.dp)) {
                        Column(Modifier.fillMaxWidth(.69f)) {
                            Text("DataCube AU", style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Bold, color = Color.White)
                            Spacer(Modifier.height(5.dp))
                            Text("Chat, analyze, and get insights from your documents.", color = Color(0xFFD4E6FA), style = MaterialTheme.typography.bodyMedium)
                        }
                        Spacer(Modifier.height(22.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(
                                onClick = onNavigateToChat,
                                modifier = Modifier.weight(1f).heightIn(min = 48.dp).scale(chatScale),
                                interactionSource = chatPress,
                                contentPadding = PaddingValues(horizontal = 8.dp),
                                colors = ButtonDefaults.buttonColors(containerColor = Color.White, contentColor = DataCubeColors.Navy)
                            ) {
                                Icon(Icons.Outlined.ChatBubbleOutline, null, Modifier.size(18.dp))
                                Spacer(Modifier.width(6.dp))
                                Text("AU Chat")
                            }
                            OutlinedButton(
                                onClick = onNavigateToStudy,
                                modifier = Modifier.weight(1f).heightIn(min = 48.dp).scale(studyScale),
                                interactionSource = studyPress,
                                contentPadding = PaddingValues(horizontal = 8.dp),
                                border = BorderStroke(1.dp, Color(0xFF81ACDA)),
                                colors = ButtonDefaults.outlinedButtonColors(contentColor = Color.White, containerColor = Color(0xB0123659))
                            ) {
                                Icon(Icons.Outlined.School, null, Modifier.size(18.dp))
                                Spacer(Modifier.width(6.dp))
                                Text("Study")
                            }
                        }
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
                val tint = DataCubeColors.Blue
                Surface(onClick = { onOpenDocument(doc.id) }, shape = RoundedCornerShape(17.dp), color = Color.White, shadowElevation = 2.dp, border = BorderStroke(1.dp, DataCubeColors.Divider)) {
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


    WorkspaceTopBar(
        documentSelected = false,
        onHome = {},
        onDocuments = onNavigateToDocuments,
        onSettings = onNavigateSettings,
        modifier = Modifier.align(Alignment.TopCenter).zIndex(2f)
            .padding(horizontal = 18.dp, vertical = 10.dp)
    )

    // The composer is always reachable; document selection is required before sending.
    Surface(
        modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth()
            .padding(horizontal = 14.dp, vertical = 8.dp)
            .navigationBarsPadding().imePadding(),
        shape = RoundedCornerShape(26.dp),
        color = Color.White,
        border = BorderStroke(1.5.dp, DataCubeColors.Blue.copy(alpha = .45f)),
        shadowElevation = 5.dp
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Searching in", color = DataCubeColors.TextSecondary, style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.width(8.dp))
                Box(Modifier.weight(1f)) {
                    OutlinedButton(
                        onClick = { if (recentDocuments.isEmpty()) onImportDocument() else documentMenuExpanded = true },
                        modifier = Modifier.fillMaxWidth(),
                        contentPadding = PaddingValues(horizontal = 9.dp, vertical = 4.dp),
                        shape = RoundedCornerShape(24.dp)
                    ) {
                        Icon(Icons.Outlined.Description, null, Modifier.size(18.dp), tint = DataCubeColors.Blue)
                        Spacer(Modifier.width(4.dp))
                        Text(
                            selectedDocument?.document?.name ?: "Upload a document",
                            modifier = Modifier.weight(1f),
                            color = DataCubeColors.Navy,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        Icon(Icons.Outlined.ArrowDropDown, "Choose document")
                    }
                    DropdownMenu(expanded = documentMenuExpanded, onDismissRequest = { documentMenuExpanded = false }) {
                        recentDocuments.forEach { entry ->
                            DropdownMenuItem(
                                text = { Text(entry.document.name, maxLines = 1) },
                                onClick = {
                                    selectedDocumentId = entry.document.id
                                    documentMenuExpanded = false
                                },
                                leadingIcon = { Icon(Icons.Outlined.Description, null) }
                            )
                        }
                        DropdownMenuItem(
                            text = { Text("Upload another document") },
                            onClick = {
                                documentMenuExpanded = false
                                onImportDocument()
                            },
                            leadingIcon = { Icon(Icons.Outlined.Add, null) }
                        )
                    }
                }
            }
            BasicTextField(
                value = quickPrompt,
                onValueChange = { quickPrompt = it.take(500) },
                enabled = selectedDocument != null,
                modifier = Modifier.fillMaxWidth().heightIn(min = 64.dp),
                textStyle = TextStyle(color = DataCubeColors.Navy, fontSize = 16.sp),
                maxLines = 4,
                decorationBox = { content ->
                    Box {
                        if (quickPrompt.isBlank()) Text(
                            if (selectedDocument == null) "Upload a document to start asking…" else "Ask anything about your document…",
                            color = DataCubeColors.TextSecondary
                        )
                        content()
                    }
                }
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onImportDocument) {
                    Icon(Icons.Outlined.Add, "Upload documents", tint = DataCubeColors.Navy)
                }
                Text("Document AU", color = DataCubeColors.TextSecondary, style = MaterialTheme.typography.labelMedium)
                Spacer(Modifier.weight(1f))
                FilledIconButton(
                    enabled = selectedDocument != null && quickPrompt.isNotBlank(),
                    colors = IconButtonDefaults.filledIconButtonColors(containerColor = DataCubeColors.Blue),
                    onClick = {
                        val target = selectedDocument
                        val question = quickPrompt.trim()
                        if (target != null && question.isNotEmpty()) {
                            onSendPromptToDocument(target.document.id, question)
                            quickPrompt = ""
                        }
                    }
                ) {
                    Icon(Icons.Outlined.Send, "Ask about selected document")
                }
            }
        }
    }
    }
}
