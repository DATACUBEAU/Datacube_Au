package au.datacube.app.ui.chat

import android.os.SystemClock
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import au.datacube.app.data.LocalDocumentProcessing
import au.datacube.app.data.rag.ConversationThreadIndex
import au.datacube.app.data.rag.ConversationWindow
import au.datacube.app.data.rag.CrossDocumentSearch
import au.datacube.app.data.rag.LocalConversationThreads
import au.datacube.app.data.rag.LocalGenerativeEngine
import au.datacube.app.data.rag.ModelOutputCleaner
import au.datacube.app.ui.common.DataCubeDialog
import au.datacube.app.ui.common.AuComposer
import au.datacube.app.ui.common.AuActivityTimeline
import au.datacube.app.ui.common.AuWorkingStatus
import au.datacube.app.ui.documents.ChatMessage
import au.datacube.app.ui.documents.DocumentChatSessions
import au.datacube.app.ui.documents.SourceSnippet
import au.datacube.app.ui.theme.dataCubeBackdrop
import au.datacube.app.ui.voice.VoiceNoteInputButton
import au.datacube.app.ui.voice.VoiceNotePlayback
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Discs: independent, private chat that can retrieve cited passages across
 * imported documents. It also supports ordinary model conversation.
 * No cloud requests and no automatic model downloads.
 */
@Composable
fun DiscsScreen(
    accountId: String,
    documents: List<LocalDocumentProcessing>,
    onBack: () -> Unit,
    onOpenDocument: (String) -> Unit,
    onOpenDocuments: () -> Unit
) {
    val context = LocalContext.current
    // Scope every conversation to the current authenticated account.
    val ownerId = remember(accountId) {
        require(accountId.matches(Regex("[A-Za-z0-9_-]{8,64}"))) { "Authenticated account required." }
        "global-$accountId"
    }
    val uiScope = rememberCoroutineScope()
    val threads = remember(context) { LocalConversationThreads(context) }
    var index by remember { mutableStateOf<ConversationThreadIndex?>(null) }
    LaunchedEffect(Unit) { index = runCatching { threads.list(ownerId) }.getOrNull() }
    val threadId = index?.activeId ?: "main"
    val session = remember(threadId) { DocumentChatSessions.get(ownerId, threadId, context) }
    val turns = session.messages
    val ready = session.historyReady && index != null
    val userTurns = turns.count { it.isUser }
    val modelReady = LocalGenerativeEngine.installed(context)
    val library = documents.map { it.document }
    var prompt by remember(threadId) { mutableStateOf("") }
    var historyOpen by remember { mutableStateOf(false) }
    var expandedSources by remember(threadId) { mutableStateOf<Set<Int>>(emptySet()) }
    var expandedProcess by remember(threadId) { mutableStateOf<Set<Int>>(emptySet()) }

    fun newChat() {
        uiScope.launch {
            runCatching { threads.create(ownerId) }.onSuccess { index = it; historyOpen = false }
        }
    }
    if (historyOpen) {
        DataCubeDialog(
            onDismissRequest = { historyOpen = false },
            title = { Text("Discs history", style = MaterialTheme.typography.titleLarge) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("Independent private conversations. Each new chat starts with a fresh context.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Column(Modifier.heightIn(max = 360.dp).verticalScroll(rememberScrollState()),
                        verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        index?.threads.orEmpty().sortedByDescending { it.updatedAt }.forEach { item ->
                            Surface(
                                onClick = {
                                    uiScope.launch {
                                        index = threads.activate(ownerId, item.id)
                                        historyOpen = false
                                    }
                                },
                                shape = RoundedCornerShape(14.dp),
                                color = if (item.id == threadId) MaterialTheme.colorScheme.primaryContainer
                                    else MaterialTheme.colorScheme.surfaceVariant
                            ) {
                                Row(Modifier.fillMaxWidth().padding(13.dp),
                                    verticalAlignment = Alignment.CenterVertically) {
                                    Icon(Icons.Outlined.ChatBubbleOutline, null,
                                        tint = MaterialTheme.colorScheme.primary)
                                    Spacer(Modifier.width(10.dp))
                                    Text(item.title, Modifier.weight(1f), maxLines = 2)
                                    if (item.id == threadId) Icon(Icons.Outlined.Check, null,
                                        tint = MaterialTheme.colorScheme.primary)
                                }
                            }
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = ::newChat) { Text("New chat") } },
            dismissButton = { TextButton(onClick = { historyOpen = false }) { Text("Close") } }
        )
    }

    fun send(
        question: String = prompt.trim(),
        label: String = question,
        audioPath: String? = null,
        alreadyAdded: Boolean = false
    ) {
        if (!ready || session.searching || question.isBlank() ||
            (!alreadyAdded && userTurns >= ConversationWindow.MAX_USER_TURNS)) return
        if (audioPath == null) prompt = ""
        if (!alreadyAdded) turns.add(ChatMessage(label, emptyList(), true, audioPath = audioPath))
        session.searching = true
        session.searchingStage = "Planning your search"
        session.activeRequest = session.scope.launch {
            val events = mutableListOf<String>()
            try {
                threads.nameFromQuestion(ownerId, threadId, question)
                val isLibraryQuery = Regex(
                    """(?i)\b(?:list|show|which|what)\b.*\b(?:my|uploaded|saved)\b.*\bdocuments?\b"""
                ).containsMatchIn(question)
                if (isLibraryQuery) {
                    val listing = if (library.isEmpty()) "No documents have been imported yet."
                    else library.take(40).joinToString("\n") { "• " + it.name }
                    events += "Listed imported document titles"
                    turns.add(ChatMessage(question, emptyList(), false,
                        answer = "You have ${library.size} imported document(s).\n$listing",
                        steps = events.toList()))
                } else {
                    session.searchingStage = "Searching your documents"
                    val sourceResults = CrossDocumentSearch(context.filesDir).search(library, question)
                    events += "Searched extracted text across ${library.size} document(s)"
                    val matches = sourceResults.map {
                        SourceSnippet(it.text, it.page, it.documentId, it.documentName)
                    }
                    events += "Selected ${matches.size} supporting passage(s)"
                    val answerIndex = turns.size
                    turns.add(ChatMessage(question, matches, false,
                        generating = modelReady, steps = events.toList()))
                    if (!modelReady) {
                        turns[answerIndex] = turns[answerIndex].copy(
                            answer = if (matches.isEmpty())
                                "No matching passages found. Install and select an AI model in Models to enable conversation."
                            else "I found related passages in ${matches.mapNotNull { it.documentName }.distinct().size} documents. Open Sources to inspect them. Install a chat model for a synthesized answer.",
                            steps = events.toList()
                        )
                    } else {
                        session.searchingStage = "AI is thinking"
                        val evidenceText = if (matches.isEmpty()) {
                            "No relevant passages were retrieved from the imported documents."
                        } else matches.mapIndexed { i, source ->
                            "[${i + 1}] Document: ${source.documentName ?: "Unknown"}" +
                                (source.page?.let { " · Page $it" } ?: "") +
                                "\n${source.text}"
                        }.joinToString("\n\n")
                        val lastAnswers = turns.take(answerIndex).filter { !it.isUser && it.answer.isNotBlank() }
                            .takeLast(2).joinToString("\n") { "Previous reply: ${it.answer.take(240)}" }
                        val input = """
                            QUESTION: ${question.take(700)}
                            PREVIOUS CHAT (not source evidence):
                            $lastAnswers
                            DOCUMENT SEARCH RESULTS:
                            $evidenceText

                            Answer the question clearly in a conversational study-assistant style.
                            When relying on documents, cite a matching numbered source [1], [2] and name the document.
                            If the search has no relevant results, answer using general knowledge and say that this was not found in the user's documents.
                            Keep answers concise; never invent document details or citations.
                        """.trimIndent().take(13_000)
                        var raw = ""
                        var lastUpdate = 0L
                        try {
                            LocalGenerativeEngine.generate(context, input, allowGeneral = true) { text ->
                                raw += text
                                val now = SystemClock.elapsedRealtime()
                                if (now - lastUpdate > 120L) {
                                    val visible = ModelOutputCleaner.visible(raw, matches.size)
                                    withContext(Dispatchers.Main) {
                                        turns[answerIndex] = turns[answerIndex].copy(answer = visible)
                                    }
                                    lastUpdate = now
                                }
                            }
                            events += "Generated an answer using the selected AI"
                            turns[answerIndex] = turns[answerIndex].copy(
                                answer = ModelOutputCleaner.visible(raw, matches.size).trim(),
                                generating = false,
                                steps = events.toList()
                            )
                        } catch (cancelled: CancellationException) {
                            throw cancelled
                        } catch (error: Exception) {
                            turns[answerIndex] = turns[answerIndex].copy(
                                generating = false,
                                generationError = error.message ?: "AI could not finish the reply."
                            )
                        }
                    }
                }
            } catch (cancelled: CancellationException) {
                val last = turns.lastIndex
                if (last >= 0 && !turns[last].isUser) {
                    turns[last] = turns[last].copy(generating = false,
                        generationError = "Reply stopped.")
                }
                throw cancelled
            } catch (error: Exception) {
                turns.add(ChatMessage(question, emptyList(), false,
                    generationError = "The search could not finish."))
            } finally {
                session.searching = false
                session.searchingStage = ""
                session.activeRequest = null
            }
        }
    }

    Column(Modifier.fillMaxSize().dataCubeBackdrop()) {
        Surface(shape = RoundedCornerShape(bottomStart = 24.dp, bottomEnd = 24.dp),
            color = MaterialTheme.colorScheme.surface, tonalElevation = 3.dp) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onBack) { Icon(Icons.Outlined.ArrowBack, "Back") }
                Column(Modifier.weight(1f)) {
                    Text("Discs", fontWeight = FontWeight.Bold,
                        style = MaterialTheme.typography.titleLarge)
                    Text("${library.size} documents · ${if (modelReady) "AI ready" else "Document search"}",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                IconButton(onClick = ::newChat, enabled = ready) {
                    Icon(Icons.Outlined.AddCircleOutline, "New conversation")
                }
                IconButton(onClick = { historyOpen = true }) {
                    Icon(Icons.Outlined.MoreVert, "Conversation history")
                }
            }
        }

        if (turns.isEmpty() && !session.searching) {
            Column(Modifier.weight(1f).fillMaxWidth().padding(25.dp),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(Icons.Outlined.AutoAwesome, null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(48.dp))
                Spacer(Modifier.height(12.dp))
                Text("One chat. All your documents.", fontWeight = FontWeight.Bold,
                    style = MaterialTheme.typography.titleLarge)
                Spacer(Modifier.height(6.dp))
                Text("Ask naturally, compare your study materials and inspect where answers came from.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodyMedium)
                Spacer(Modifier.height(20.dp))
                OutlinedButton(onClick = onOpenDocuments) {
                    Icon(Icons.Outlined.FolderOpen, null)
                    Spacer(Modifier.width(8.dp))
                    Text("Open document library")
                }
            }
        } else {
            LazyColumn(Modifier.weight(1f).fillMaxWidth(),
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 14.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)) {
                items(turns) { message ->
                    if (message.isUser) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                            Surface(color = MaterialTheme.colorScheme.primaryContainer,
                                shape = RoundedCornerShape(20.dp, 20.dp, 5.dp, 20.dp)) {
                                if (message.audioPath != null) {
                                    VoiceNotePlayback(message.audioPath, message.question)
                                } else {
                                    Text(message.question, Modifier.padding(15.dp),
                                        color = MaterialTheme.colorScheme.onPrimaryContainer)
                                }
                            }
                        }
                    } else {
                        Surface(shape = RoundedCornerShape(20.dp),
                            color = MaterialTheme.colorScheme.surface,
                            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
                            Column(Modifier.padding(15.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                Text("AU", fontWeight = FontWeight.Bold,
                                    color = MaterialTheme.colorScheme.primary)
                                if (message.answer.isNotBlank()) Text(message.answer,
                                    color = MaterialTheme.colorScheme.onSurface,
                                    style = MaterialTheme.typography.bodyLarge)
                                if (message.generating) LinearProgressIndicator(Modifier.fillMaxWidth())
                                message.generationError?.let { Text(it,
                                    color = MaterialTheme.colorScheme.error,
                                    style = MaterialTheme.typography.bodySmall) }
                                val i = turns.indexOf(message)
                                if (message.matches.isNotEmpty()) {
                                    TextButton(onClick = {
                                        expandedSources = if (i in expandedSources) expandedSources - i
                                            else expandedSources + i
                                    }) {
                                        Icon(Icons.Outlined.MenuBook, null)
                                        Spacer(Modifier.width(7.dp))
                                        Text("Sources (${message.matches.size})")
                                        Icon(if (i in expandedSources) Icons.Outlined.ExpandLess
                                            else Icons.Outlined.ExpandMore, null)
                                    }
                                    if (i in expandedSources) message.matches.forEachIndexed { index, source ->
                                        Surface(color = MaterialTheme.colorScheme.surfaceVariant,
                                            shape = RoundedCornerShape(12.dp)) {
                                            Column(Modifier.fillMaxWidth().padding(11.dp)) {
                                                Text("[${index + 1}] ${source.documentName ?: "Document"}" +
                                                    (source.page?.let { " · Page $it" } ?: ""),
                                                    fontWeight = FontWeight.SemiBold,
                                                    color = MaterialTheme.colorScheme.onSurface)
                                                Text(source.text.take(400), maxLines = 6,
                                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                                    style = MaterialTheme.typography.bodySmall)
                                                source.documentId?.takeIf { id -> library.any { it.id == id } }?.let { id ->
                                                    TextButton(onClick = { onOpenDocument(id) }) {
                                                        Text("Open document")
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                                if (message.steps.isNotEmpty()) {
                                    TextButton(onClick = {
                                        expandedProcess = if (i in expandedProcess) expandedProcess - i else expandedProcess + i
                                    }) {
                                        Icon(Icons.Outlined.AccountTree, null)
                                        Spacer(Modifier.width(7.dp))
                                        Text("How AU worked")
                                    }
                                    if (i in expandedProcess) {
                                        AuActivityTimeline(message.steps)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        if (session.searching) {
            AuWorkingStatus(
                stage = session.searchingStage,
                onStop = { session.activeRequest?.cancel() }
            )
        }
        ConversationWindow.warning(userTurns)?.let {
            Text(it, Modifier.padding(horizontal = 18.dp, vertical = 6.dp),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.labelSmall)
        }
        AuComposer(
            value = prompt,
            onValueChange = { prompt = it.take(700) },
            onSend = { send() },
            placeholder = "Ask AU or search your documents…",
            enabled = ready && !session.searching,
            sendEnabled = ready && !session.searching && prompt.isNotBlank() &&
                userTurns < ConversationWindow.MAX_USER_TURNS,
            sendDescription = "Send question",
            actions = {
                VoiceNoteInputButton(
                    ownerId = ownerId,
                    enabled = ready && !session.searching &&
                        userTurns < ConversationWindow.MAX_USER_TURNS,
                    supportsAudio = LocalGenerativeEngine.supportsVoiceNotes(context),
                    onReady = { note ->
                        val label = "Voice note · " + note.durationSeconds + "s"
                        turns.add(ChatMessage(label, emptyList(), true,
                            audioPath = note.file.absolutePath))
                        session.searching = true
                        session.searchingStage = "AU is listening"
                        session.activeRequest = session.scope.launch {
                            try {
                                val question = LocalGenerativeEngine.understandVoiceNote(
                                    context, note.file)
                                session.searching = false
                                session.searchingStage = ""
                                send(question, label, note.file.absolutePath, alreadyAdded = true)
                            } catch (cancelled: CancellationException) {
                                session.searching = false
                                session.searchingStage = ""
                                throw cancelled
                            } catch (error: Exception) {
                                session.searching = false
                                session.searchingStage = ""
                                turns.add(ChatMessage(label, emptyList(), false,
                                    generationError = error.message ?: "AU could not understand this audio."))
                            }
                        }
                    }
                )
            }
        )
    }
}
