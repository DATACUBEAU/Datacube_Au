package au.datacube.app.ui.documents

import au.datacube.app.ui.common.DataCubeDialog
import au.datacube.app.ui.common.AuSpotlightState
import au.datacube.app.ui.common.AuSpotlightOverlay
import au.datacube.app.ui.common.LocalAuSpotlight
import au.datacube.app.ui.common.TourTarget
import au.datacube.app.ui.common.auTourTarget
import androidx.activity.compose.BackHandler
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.clearAndSetSemantics
import au.datacube.app.schedule.AuScheduleDialog
import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
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

private val workspaceTabs = listOf(
    "AU Chat",
    "Smart Note",
    "Prediction",
    "Practice",
    "Podcast"
)

@Composable
fun DocumentWorkspaceScreen(
    document: LocalDocument,
    extractionStatus: String?,
    extractionProgress: Double?,
    extractionError: String?,
    textPreview: String?,
    previewTruncated: Boolean,
    previewLoading: Boolean,
    previewError: String?,
    onBack: () -> Unit,
    onOpenModels: () -> Unit = {},
    initialPrompt: String? = null,
    initialTab: Int = 0,
    accountId: String? = null,
    collectionId: String? = null,
    collectionDocuments: List<LocalDocument> = emptyList()
) {
    var selectedTab by remember(document.id, initialTab) { mutableIntStateOf(initialTab.coerceIn(0, workspaceTabs.lastIndex)) }
    var menuExpanded by remember(document.id) { mutableStateOf(false) }
    var immersive by remember(document.id) { mutableStateOf(false) }
    var newChatToken by remember(document.id) { mutableIntStateOf(0) }
    var chatHistoryOpen by remember(document.id) { mutableStateOf(false) }
    var showDetails by remember(document.id) { mutableStateOf(false) }
    var schedulesOpen by remember(document.id) { mutableStateOf(false) }
    var scheduleTitle by remember(document.id) { mutableStateOf("Review " + document.name) }
    val context=LocalContext.current
    val guidePrefs=remember(context) { context.getSharedPreferences("au_document_guide",android.content.Context.MODE_PRIVATE) }
    var offerTools by rememberSaveable(accountId,document.id) { mutableStateOf(false) }
    var guideTools by rememberSaveable(accountId,document.id) { mutableStateOf(false) }
    val toolsSpotlight=remember(document.id) { AuSpotlightState() }
    LaunchedEffect(accountId,previewLoading,textPreview.isNullOrBlank(),initialPrompt) {
        if(accountId!=null && !previewLoading && !textPreview.isNullOrBlank() &&
            initialPrompt.isNullOrBlank() && !guidePrefs.getBoolean(accountId,false)) {
            offerTools=true
        }
    }
    fun closeToolsOffer(start:Boolean) {
        accountId?.let { guidePrefs.edit().putBoolean(it,true).apply() }
        offerTools=false
        guideTools=start
        menuExpanded=false
    }
    if(offerTools) DataCubeDialog(
        onDismissRequest={closeToolsOffer(false)},
        title={Text("Explore document tools?")},
        text={Text("See where AU Chat, Smart Note, Prediction, Practice and Podcast are located.")},
        confirmButton={Button(onClick={closeToolsOffer(true)}){Text("Show me")}},
        dismissButton={TextButton(onClick={closeToolsOffer(false)}){Text("Not now")}}
    )
    BackHandler(enabled=guideTools) { guideTools=false }
    if (schedulesOpen && accountId != null) {
        AuScheduleDialog(accountId, "document:${document.id}", scheduleTitle,
            onDismiss = { schedulesOpen = false })
    }


    if (showDetails) {
        DataCubeDialog(
            onDismissRequest = { showDetails = false },
            title = { Text("Document details") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(document.name)
                    Text("${document.extension.uppercase()} · ${formatDocumentSize(document.sizeBytes)}")
                    Text("Stored locally on this device")
                }
            },
            confirmButton = { TextButton(onClick = { showDetails = false }) { Text("Done") } }
        )
    }

    val parentSpotlight=LocalAuSpotlight.current
    CompositionLocalProvider(LocalAuSpotlight provides if(guideTools) toolsSpotlight else parentSpotlight) {
    Box(Modifier.fillMaxSize()) {
    Column(Modifier.fillMaxSize().dataCubeBackdrop().then(if(guideTools) Modifier.clearAndSetSemantics {} else Modifier)) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 5.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            IconButton(onClick = onBack) {
                Icon(Icons.Outlined.ArrowBack, contentDescription = "Back to documents")
            }
            if (!immersive) {
                Spacer(Modifier.width(5.dp))
                Column(Modifier.weight(1f)) {
                    Text(document.name, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurface)
                    Text(
                        "${document.extension.uppercase()} · ${formatDocumentSize(document.sizeBytes)}",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            } else {
                Spacer(Modifier.weight(1f))
            }
            IconButton(onClick = { immersive = !immersive }) {
                Icon(
                    if (immersive) Icons.Outlined.FullscreenExit else Icons.Outlined.Fullscreen,
                    contentDescription = if (immersive) "Exit focus mode" else "Enter focus mode"
                )
            }
            Box {
                IconButton(onClick = { menuExpanded = true },modifier=Modifier.auTourTarget(TourTarget.DOCUMENT_TOOLS)) {
                    Icon(Icons.Outlined.MoreVert, contentDescription = "Document options and tools")
                }
                DropdownMenu(
                    expanded = menuExpanded,
                    onDismissRequest = { menuExpanded = false }
                ) {
                    Text(
                        "Document tools",
                        Modifier.padding(start = 16.dp, top = 8.dp, bottom = 5.dp),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.labelMedium
                    )
                    workspaceTabs.forEachIndexed { index, tab ->
                        val icon = when (index) {
                            0 -> Icons.Outlined.ChatBubbleOutline
                            1 -> Icons.Outlined.Notes
                            2 -> Icons.Outlined.BarChart
                            3 -> Icons.Outlined.Layers
                            else -> Icons.Outlined.Headphones
                        }
                        DropdownMenuItem(
                            text = {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(tab)
                                    if (selectedTab == index) {
                                        Spacer(Modifier.width(6.dp))
                                        Icon(Icons.Outlined.Check, null, Modifier.size(17.dp))
                                    }
                                }
                            },
                            leadingIcon = { Icon(icon, null) },
                            onClick = {
                                selectedTab = index
                                menuExpanded = false
                            }
                        )
                    }
                    HorizontalDivider()
                    DropdownMenuItem(
                        text={Text("Guide to document tools")},
                        leadingIcon={Icon(Icons.Outlined.Info,null)},
                        onClick={menuExpanded=false;guideTools=true}
                    )
                    if (accountId != null) {
                        DropdownMenuItem(
                            text = { Text("Schedules") },
                            leadingIcon = { Icon(Icons.Outlined.Schedule, null) },
                            onClick = { scheduleTitle = "Review " + document.name; schedulesOpen = true; menuExpanded = false }
                        )
                    }
                    DropdownMenuItem(
                        text = { Text("New chat") },
                        leadingIcon = { Icon(Icons.Outlined.Add, null) },
                        onClick = {
                            selectedTab = 0
                            newChatToken += 1
                            menuExpanded = false
                        }
                    )
                    DropdownMenuItem(
                        text = { Text("History") },
                        leadingIcon = { Icon(Icons.Outlined.History, null) },
                        onClick = {
                            selectedTab = 0
                            chatHistoryOpen = true
                            menuExpanded = false
                        }
                    )
                    DropdownMenuItem(
                        text = { Text("Document info") },
                        leadingIcon = { Icon(Icons.Outlined.Info, null) },
                        onClick = { showDetails = true; menuExpanded = false }
                    )
                }
            }
        }

        when (selectedTab) {
            0 -> DocumentChatWorkspace(
                documentId = document.id,
                accountId = accountId,
                collectionId = collectionId,
                collectionDocuments = collectionDocuments,
                documentName = document.name,
                initialPrompt = initialPrompt,
                textPreview = textPreview,
                previewLoading = previewLoading,
                previewError = previewError,
                extractionStatus = extractionStatus,
                extractionProgress = extractionProgress,
                extractionError = extractionError,
                showHistoryPicker = chatHistoryOpen,
                onOpenHistory = { chatHistoryOpen = true },
                onDismissHistory = { chatHistoryOpen = false },
                newChatToken = newChatToken,
                onOpenModels = onOpenModels,
                onScheduleRequest = if (accountId != null) { request ->
                    scheduleTitle = request
                    schedulesOpen = true
                } else null
            )
            1 -> SmartNoteWorkspace(document.name, textPreview, previewLoading, document.id, onOpenModels)
            2 -> PredictionWorkspace(document.name, textPreview, previewLoading, document.id, onOpenModels)
            3 -> PracticeWorkspace(document.name, textPreview, previewLoading, document.id, onOpenModels)
            else -> PodcastWorkspace(document.id, document.name, textPreview, previewLoading)
        }
    }
    if(guideTools) {
        AuSpotlightOverlay(toolsSpotlight,TourTarget.DOCUMENT_TOOLS,"Study your way",
            "AU Chat answers questions. Smart Note creates notes. Prediction suggests revision priorities. Practice tests your understanding. Podcast turns the document into a discussion.",
            "Open tools",0,1,onNext={guideTools=false;menuExpanded=true},onSkip={guideTools=false})
    }
    }
    }
}

private fun formatDocumentSize(bytes: Long): String =
    if (bytes >= 1024L * 1024L) {
        String.format("%.1f MB", bytes / (1024.0 * 1024.0))
    } else {
        "${(bytes / 1024L).coerceAtLeast(1L)} KB"
    }
