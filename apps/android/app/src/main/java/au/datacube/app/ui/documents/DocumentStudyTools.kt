package au.datacube.app.ui.documents

import au.datacube.app.ui.common.DataCubeDialog
import au.datacube.app.ui.common.AuComposer
import au.datacube.app.ui.common.AuActivityTimeline
import au.datacube.app.ui.common.AuWorkingStatus
import android.speech.tts.TextToSpeech
import android.speech.tts.Voice
import au.datacube.app.audio.OfflineNarrationPreferences
import au.datacube.app.audio.NeuralNarration
import android.speech.tts.UtteranceProgressListener
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.text.ClickableText
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.Canvas
import androidx.compose.ui.geometry.Offset
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import au.datacube.app.data.LocalJobStatus
import au.datacube.app.data.rag.RagTextChunker
import au.datacube.app.data.rag.RagBm25Index
import au.datacube.app.data.rag.LocalSemanticSearch
import au.datacube.app.data.rag.DocumentQueryInterpreter
import au.datacube.app.data.rag.LocalGenerativeEngine
import au.datacube.app.data.rag.ModelOutputCleaner
import au.datacube.app.data.rag.LocalConversationThreads
import au.datacube.app.data.rag.ConversationThreadIndex
import au.datacube.app.data.rag.ConversationWindow
import au.datacube.app.data.rag.SourceTermGrounding
import au.datacube.app.data.rag.TermContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.Job
import au.datacube.app.data.rag.GroundedRagPlanner
import au.datacube.app.data.rag.RagEvidence
import au.datacube.app.data.rag.RagTurn
import au.datacube.app.data.rag.StudyContentQuality
import android.os.SystemClock
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.CancellationException
import androidx.work.WorkInfo
import au.datacube.app.ui.voice.VoiceNoteInputButton
import au.datacube.app.ui.voice.VoiceNotePlayback
import au.datacube.app.ui.theme.DataCubeColors
import java.util.Locale
import kotlinx.coroutines.launch

internal data class SourceSnippet(val text: String, val page: Int?, val documentId: String? = null, val documentName: String? = null)
private data class StudyQuestion(val prompt: String, val reference: String, val page: Int?, val topic: String)
internal data class ChatMessage(
    val question: String,
    val matches: List<SourceSnippet>,
    val isUser: Boolean,
    val semantic: Boolean = false,
    val overview: Boolean = false,
    val steps: List<String> = emptyList(),
    val corrected: Map<String, String> = emptyMap(),
    val answer: String = "",
    val generating: Boolean = false,
    val generationError: String? = null,
    val audioPath: String? = null
)

private fun sourceSnippets(raw: String?): List<SourceSnippet> {
    val content = raw?.take(48_000)?.trim().orEmpty()
    if (content.isBlank()) return emptyList()
    val marker = Regex("(?m)^----- Page (\\d+) -----\\s*")
    val matches = marker.findAll(content).toList()
    val blocks = if (matches.isEmpty()) listOf(SourceSnippet(content, null)) else {
        matches.mapIndexedNotNull { index, match ->
            val start = match.range.last + 1
            val end = matches.getOrNull(index + 1)?.range?.first ?: content.length
            content.substring(start, end).trim().takeIf(String::isNotBlank)
                ?.let { SourceSnippet(it, match.groupValues[1].toIntOrNull()) }
        }
    }
    return blocks.flatMap { block ->
        block.text.replace('\u0000', ' ')
            .split(Regex("(?<=[.!?])\\s+|\\n+"))
            .map(String::trim)
            .filter { it.length >= 24 && it.any(Char::isLetter) }
            .map { SourceSnippet(it, block.page) }
    }.distinctBy { it.text.lowercase() }.take(120)
}

private val ignoredTerms = setOf(
    "about", "after", "again", "also", "among", "because", "been", "being", "between",
    "could", "does", "doing", "during", "each", "from", "have", "into", "just", "more",
    "most", "other", "over", "same", "should", "some", "such", "than", "that", "their",
    "them", "then", "there", "these", "they", "this", "those", "through", "under", "until",
    "very", "were", "what", "when", "where", "which", "while", "with", "would", "your",
    "shall", "will", "must", "using", "used", "however"
)

private fun documentTopics(raw: String?): List<String> {
    val content = raw?.take(48_000).orEmpty()
    if (content.isBlank()) return emptyList()
    val headings = content.lineSequence()
        .map { it.trim().trim('#', '*', '-', ' ') }
        .filter { line ->
            val words = line.split(Regex("\\s+"))
            line.length in 4..72 && words.size in 1..7 &&
                !line.endsWith('.') && !line.endsWith(';') &&
                !line.startsWith("Page ", ignoreCase = true) &&
                StudyContentQuality.usefulHeading(line)
        }
        .distinctBy { it.lowercase() }.take(5).toList()

    val frequentTerms = Regex("[\\p{L}][\\p{L}'’-]{4,}")
        .findAll(content.lowercase())
        .map { it.value.trim('’', '\'', '-') }
        .filterNot { it in ignoredTerms }
        .groupingBy { it }.eachCount().entries
        .filter { it.value >= 3 }
        .sortedByDescending { it.value }
        .map { it.key.replaceFirstChar { char -> char.titlecase(Locale.getDefault()) } }
        .filterNot { candidate -> headings.any { it.equals(candidate, ignoreCase = true) } }
        .take(6)
    return (headings + frequentTerms).distinctBy { it.lowercase() }.take(8)
}

private fun documentSummary(raw: String?): String =
    StudyContentQuality.extractiveSummary(
        sourceSnippets(raw).map { RagEvidence(it.text, it.page) }
    )

private fun suggestedStudyQuestions(raw: String?, count: Int = 5): List<StudyQuestion> {
    val snippets = sourceSnippets(raw)
    if (snippets.isEmpty()) return emptyList()
    val topics = documentTopics(raw)
    val topicQuestions = topics.mapNotNull { topic ->
        val source = snippets.firstOrNull { it.text.contains(topic, ignoreCase = true) }
            ?: snippets.firstOrNull() ?: return@mapNotNull null
        StudyQuestion("Explain " + topic + " and describe the key idea presented in your notes.", source.text, source.page, topic)
    }
    val fallbacks = snippets.filter { snippet -> topicQuestions.none { it.reference == snippet.text } }
        .mapIndexed { index, snippet ->
            StudyQuestion("Summarize the main point in passage " + (index + 1) + ".", snippet.text, snippet.page, "Passage " + (index + 1))
        }
    return (topicQuestions + fallbacks).distinctBy { it.prompt }.take(count.coerceIn(1, 20))
}

private fun findRelevantSnippets(query: String, raw: String?): List<SourceSnippet> {
    val text = raw?.take(48_000).orEmpty()
    if (query.isBlank() || text.isBlank()) return emptyList()
    val chunks = RagTextChunker().chunk("document-preview", text)
    return RagBm25Index(chunks).search(query, limit = 4)
        .map { SourceSnippet(it.text, it.page) }
}

@Composable
private fun ToolPage(title: String, subtitle: String, content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(title, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)
            Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        content()
    }
}

@Composable
private fun ToolCard(content: @Composable ColumnScope.() -> Unit) {
    Surface(
        Modifier.fillMaxWidth(), shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant), tonalElevation = 1.dp
    ) {
        Column(Modifier.padding(16.dp), content = content)
    }
}

@Composable
private fun SourceUnavailableCard(
    previewLoading: Boolean,
    previewError: String?,
    extractionStatus: String? = null,
    extractionProgress: Double? = null,
    extractionError: String? = null
) {
    ToolCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Outlined.Description, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text("Waiting for extracted document text", fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurface)
                Text(
                    when {
                        previewLoading -> "Loading the private on-device text preview."
                        previewError != null -> previewError
                        extractionStatus == LocalJobStatus.RUNNING -> "Extraction is running on this device."
                        extractionStatus == LocalJobStatus.QUEUED || extractionStatus == LocalJobStatus.RETRYABLE -> "Local extraction is queued."
                        extractionStatus == LocalJobStatus.FAILED -> extractionError ?: "Local extraction failed."
                        else -> "Import a supported file and let local extraction finish."
                    },
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            if (previewLoading || extractionStatus == LocalJobStatus.RUNNING) {
                CircularProgressIndicator(
                    progress = { (extractionProgress ?: 0.15).toFloat().coerceIn(0.05f, 1f) },
                    Modifier.size(24.dp), strokeWidth = 2.dp
                )
            }
        }
        Spacer(Modifier.height(12.dp))
        Text(
            "These study tools use text already extracted on your device. They do not invent answers or success probabilities when source text is unavailable.",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

@Composable
fun DocumentChatWorkspace(
    documentId: String,
    documentName: String, initialPrompt: String? = null, textPreview: String?, previewLoading: Boolean, previewError: String?,
    extractionStatus: String?, extractionProgress: Double?, extractionError: String?,
    showHistoryPicker: Boolean = false,
    onDismissHistory: () -> Unit = {}
) {
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    val scope = rememberCoroutineScope()
    val semanticSearch = remember(context) { LocalSemanticSearch(context) }
    val semanticSupported = semanticSearch.supported()
    val llmInstalled = LocalGenerativeEngine.installed(context)
    val indexingFlow = remember(documentId) { semanticSearch.observeIndex(documentId) }
    val indexingWorks by indexingFlow.collectAsState(initial = emptyList())
    val indexing = indexingWorks.any { it.state == WorkInfo.State.RUNNING || it.state == WorkInfo.State.ENQUEUED }
    val threads = remember(context) { LocalConversationThreads(context) }
    var threadIndex by remember(documentId) { mutableStateOf<ConversationThreadIndex?>(null) }
    LaunchedEffect(documentId) {
        threadIndex = runCatching { threads.list(documentId) }.getOrNull()
    }
    LaunchedEffect(showHistoryPicker) {
        if (showHistoryPicker) threadIndex = runCatching { threads.list(documentId) }.getOrNull()
    }
    val threadId = threadIndex?.activeId ?: "main"
    val session = remember(documentId, threadId) {
        DocumentChatSessions.get(documentId, threadId, context)
    }
    val messages = session.messages
    val historyReady = session.historyReady
    val userTurns = messages.count { it.isUser }
    fun startNewChat() {
        scope.launch {
            runCatching { threads.create(documentId) }
                .onSuccess { threadIndex = it; onDismissHistory() }
        }
    }
    if (showHistoryPicker) {
        DataCubeDialog(
            onDismissRequest = onDismissHistory,
            title = { Text("Your chat history", style = MaterialTheme.typography.titleLarge) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Each chat has its own context. Running replies keep working when you switch chats.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodySmall)
                    Column(Modifier.fillMaxWidth().heightIn(max = 330.dp).verticalScroll(rememberScrollState()),
                        verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        (threadIndex?.threads.orEmpty()).sortedByDescending { it.updatedAt }.forEach { item ->
                            Surface(
                                onClick = {
                                    scope.launch {
                                        threadIndex = threads.activate(documentId, item.id)
                                        onDismissHistory()
                                    }
                                },
                                shape = RoundedCornerShape(14.dp),
                                color = if (item.id == threadId) MaterialTheme.colorScheme.primaryContainer
                                    else MaterialTheme.colorScheme.surfaceVariant
                            ) {
                                Row(Modifier.fillMaxWidth().padding(13.dp),
                                    verticalAlignment = Alignment.CenterVertically) {
                                    Icon(Icons.Outlined.ChatBubbleOutline, contentDescription = null,
                                        tint = MaterialTheme.colorScheme.primary)
                                    Spacer(Modifier.width(10.dp))
                                    Text(item.title, Modifier.weight(1f), maxLines = 2,
                                        color = MaterialTheme.colorScheme.onSurface)
                                    if (item.id == threadId) Icon(Icons.Outlined.Check, null,
                                        tint = MaterialTheme.colorScheme.primary)
                                }
                            }
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = ::startNewChat) { Text("New chat") } },
            dismissButton = { TextButton(onClick = onDismissHistory) { Text("Close") } }
        )
    }
    var openedEvidence by remember(documentId) { mutableStateOf<SourceSnippet?>(null) }
    var expandedSteps by remember(documentId, threadId) { mutableStateOf<Set<Int>>(emptySet()) }
    var expandedSources by remember(documentId, threadId) { mutableStateOf<Set<Int>>(emptySet()) }
    var tappedTerm by remember(documentId) { mutableStateOf<TermContext?>(null) }
    var termExplanation by remember(documentId) { mutableStateOf("") }
    var explainingTerm by remember(documentId) { mutableStateOf(false) }
    var termRequest by remember(documentId) { mutableStateOf<Job?>(null) }
    LaunchedEffect(documentId, textPreview, semanticSupported) {
        if (semanticSupported && !textPreview.isNullOrBlank()) {
            semanticSearch.scheduleIndex(documentId)
        }
    }
    var prompt by remember(documentName, initialPrompt) { mutableStateOf(initialPrompt.orEmpty()) }
    fun submitQuestion(
        cleanPrompt: String,
        displayQuestion: String = cleanPrompt,
        audioPath: String? = null,
        alreadyAdded: Boolean = false
    ) {
                        if (cleanPrompt.isNotEmpty() && !textPreview.isNullOrBlank() && !session.searching && (alreadyAdded || userTurns < ConversationWindow.MAX_USER_TURNS)) {
                            if (!alreadyAdded) messages.add(ChatMessage(displayQuestion, emptyList(), true, audioPath = audioPath))
                            if (audioPath == null) prompt = ""
                            session.searching = true
                            // The response belongs to the document/thread session, not
                            // this Compose screen; navigation must not cancel it.
                            session.scope.launch { threads.nameFromQuestion(documentId, threadId, cleanPrompt) }
                            session.activeRequest = session.scope.launch {
                                val events = mutableListOf<String>()
                                try {
                                    session.searchingStage = "Understanding your question"
                                    val plan = DocumentQueryInterpreter.understand(cleanPrompt, textPreview.orEmpty())
                                    if (plan.correctedTerms.isNotEmpty()) events += "Resolved wording against document terms"
                                    val matches: List<SourceSnippet>
                                    var usedSemantic = false
                                    if (plan.overview) {
                                        session.searchingStage = "Collecting source excerpts"
                                        matches = StudyContentQuality.chooseOverview(
                                            sourceSnippets(textPreview).map { RagEvidence(it.text, it.page) }
                                        ).map { SourceSnippet(it.text, it.page) }
                                        events += "Selected source passages for an overview"
                                    } else {
                                        session.searchingStage = "Searching document text"
                                        val bm25 = findRelevantSnippets(plan.retrievalQuery, textPreview)
                                        events += "Ranked extracted text with BM25"
                                        val vectorMatches = if (semanticSupported && !indexing) {
                                            session.searchingStage = "Checking semantic matches"
                                            events += "Queried the on-device vector index"
                                            runCatching { semanticSearch.search(documentId, plan.retrievalQuery, 6) }
                                                .getOrDefault(emptyList())
                                        } else emptyList()
                                        usedSemantic = vectorMatches.isNotEmpty()
                                        matches = GroundedRagPlanner.fuse(
                                            bm25.map { RagEvidence(it.text, it.page) },
                                            vectorMatches.map { RagEvidence(it.text, it.page) }
                                        ).map { SourceSnippet(it.text, it.page) }
                                        if (usedSemantic) events += "Combined BM25 and vector ranks"
                                    }
                                    events += "Linked ${matches.size} source passage(s)"
                                    val resultIndex = messages.size
                                    messages.add(ChatMessage(
                                        question = cleanPrompt, matches = matches, isUser = false,
                                        semantic = usedSemantic, overview = plan.overview,
                                        steps = events.toList(), corrected = plan.correctedTerms,
                                        generating = llmInstalled && matches.isNotEmpty()
                                    ))
                                    if (llmInstalled && matches.isNotEmpty()) {
                                        session.searchingStage = "AI is preparing the answer"
                                        val previous = messages.take(resultIndex)
                                            .filter { !it.isUser && it.answer.isNotBlank() }
                                            .takeLast(3)
                                            .map { RagTurn(it.question, it.answer) }
                                        val grounded = GroundedRagPlanner.build(
                                            cleanPrompt, previous,
                                            matches.map { RagEvidence(it.text, it.page) }
                                        )
                                        events += "Built context from ${grounded.evidence.size} source passages"
                                        var generated = ""
                                        var lastUpdate = 0L
                                        try {
                                            session.searchingStage = "AI is thinking"
                                            LocalGenerativeEngine.generate(context, grounded.value) { part ->
                                                generated += part
                                                val now = SystemClock.elapsedRealtime()
                                                if (now - lastUpdate > 90L) {
                                                    withContext(Dispatchers.Main) {
                                                        messages[resultIndex] = messages[resultIndex].copy(
                                                            answer = ModelOutputCleaner.visible(generated, matches.size)
                                                        )
                                                    }
                                                    lastUpdate = now
                                                }
                                            }
                                            events += "Generated an answer using the selected local chat model on this device"
                                            messages[resultIndex] = messages[resultIndex].copy(
                                                answer = ModelOutputCleaner.visible(generated, matches.size).trim(),
                                                generating = false,
                                                steps = events.toList()
                                            )
                                        } catch (cancelled: CancellationException) {
                                            throw cancelled
                                        } catch (generationError: Exception) {
                                            events += "Local generation failed; retrieved sources remain available"
                                            messages[resultIndex] = messages[resultIndex].copy(
                                                answer = ModelOutputCleaner.visible(generated, matches.size).trim(),
                                                generating = false,
                                                generationError = generationError.message
                                                    ?: "AU could not finish the answer.",
                                                steps = events.toList()
                                            )
                                        }
                                    }
                                } catch (cancelled: CancellationException) {
                                    val lastIndex = messages.lastIndex
                                    if (lastIndex >= 0 && !messages[lastIndex].isUser) {
                                        messages[lastIndex] = messages[lastIndex].copy(
                                            generating = false,
                                            generationError = "Generation stopped."
                                        )
                                    }
                                    throw cancelled
                                } catch (error: Exception) {
                                    events += "Search could not finish: ${error.message ?: "unknown error"}"
                                    messages.add(ChatMessage(cleanPrompt, emptyList(), false, steps = events.toList()))
                                } finally {
                                    session.searching = false
                                    session.searchingStage = ""
                                }
                            }
                        }
                    
    }

    tappedTerm?.let { info ->
        DataCubeDialog(
            onDismissRequest = {
                termRequest?.cancel()
                tappedTerm = null
                explainingTerm = false
            },
            title = { Text(info.term) },
            text = {
                Column(Modifier.heightIn(max = 350.dp).verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(info.page?.let { "Source · Page $it" } ?: "Source",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.primary)
                    SelectionContainer { Text(info.excerpt) }
                    if (termExplanation.isNotBlank()) {
                        HorizontalDivider()
                        Text(termExplanation, style = MaterialTheme.typography.bodyMedium)
                    }
                    if (explainingTerm) LinearProgressIndicator(Modifier.fillMaxWidth())
                }
            },
            confirmButton = {
                if (llmInstalled && !explainingTerm && termExplanation.isBlank()) {
                    TextButton(onClick = {
                        explainingTerm = true
                        termRequest = scope.launch {
                            val grounded = GroundedRagPlanner.build(
                                "Explain the meaning of '${info.term}' as used in this passage, in 1-2 sentences.",
                                emptyList(), listOf(RagEvidence(info.excerpt, info.page))
                            )
                            try {
                                var raw = ""
                                LocalGenerativeEngine.generate(context, grounded.value) { part ->
                                    raw += part
                                    withContext(Dispatchers.Main) {
                                        termExplanation = ModelOutputCleaner.visible(raw, 1).take(1200)
                                    }
                                }
                            } catch (error: CancellationException) {
                                throw error
                            } catch (error: Exception) {
                                termExplanation = "Could not explain this term with the local model."
                            } finally {
                                explainingTerm = false
                            }
                        }
                    }) { Text("Explain locally") }
                }
            },
            dismissButton = {
                TextButton(onClick = {
                    termRequest?.cancel()
                    tappedTerm = null
                    explainingTerm = false
                }) { Text("Close") }
            }
        )
    }

    openedEvidence?.let { evidence ->
        DataCubeDialog(
            onDismissRequest = { openedEvidence = null },
            title = {
                Text(evidence.page?.let { "Source · Page $it" } ?: "Source · Extracted text")
            },
            text = {
                Column(Modifier.heightIn(max = 350.dp).verticalScroll(rememberScrollState())) {
                    SelectionContainer { Text(evidence.text) }
                }
            },
            confirmButton = {
                TextButton(onClick = { openedEvidence = null }) { Text("Close") }
            },
            dismissButton = {
                TextButton(onClick = { clipboard.setText(AnnotatedString(evidence.text)) }) {
                    Text("Copy")
                }
            }
        )
    }

    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Outlined.Search, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.width(8.dp))
            Column(Modifier.weight(1f)) {
                Text("Searching in", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(documentName, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurface)
            }
            AssistChip(onClick = {}, enabled = false, label = {
                Text(when {
                    indexing -> "Indexing"
                    llmInstalled -> "AU ready"
                    semanticSupported -> "Search ready"
                    else -> "Search ready"

                })
            })
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp),
            verticalAlignment = Alignment.CenterVertically) {
            ConversationWindow.warning(userTurns)?.let { warning ->
                Text(warning, Modifier.weight(1f),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.labelSmall)
            } ?: Spacer(Modifier.weight(1f))
            IconButton(onClick = ::startNewChat, enabled = threadIndex != null) {
                Icon(Icons.Outlined.AddCircleOutline, contentDescription = "Start new chat")
            }
        }
        if (textPreview.isNullOrBlank()) {
            Box(Modifier.weight(1f).fillMaxWidth().padding(12.dp), contentAlignment = Alignment.Center) {
                SourceUnavailableCard(previewLoading, previewError, extractionStatus, extractionProgress, extractionError)
            }
        } else if (messages.isEmpty()) {
            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                Column(Modifier.padding(28.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(9.dp)) {
                    Icon(Icons.Outlined.ChatBubbleOutline, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(42.dp))
                    Text("Ask about this document", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)
                    Text(
                        if (llmInstalled) "Ask AU. Answers use your document and link to supporting passages."
                        else "Read local source passages. Install a chat model in Models to enable answers.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf("Summarize the key ideas", "Find important definitions").forEach { suggestion ->
                            AssistChip(onClick = { prompt = suggestion }, label = { Text(suggestion, maxLines = 1) })
                        }
                    }
                }
            }
        } else {
            LazyColumn(
                Modifier.weight(1f).fillMaxWidth(),
                contentPadding = PaddingValues(horizontal = 14.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                items(messages) { message ->
                    if (message.isUser) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                            Surface(shape = RoundedCornerShape(18.dp, 18.dp, 4.dp, 18.dp), color = MaterialTheme.colorScheme.primaryContainer) {
                                if (message.audioPath != null) {
                                    VoiceNotePlayback(message.audioPath, message.question)
                                } else {
                                    Text(message.question, Modifier.padding(13.dp),
                                        color = MaterialTheme.colorScheme.onSurface)
                                }
                            }
                        }
                    } else {
                        ToolCard {
                            Text(
                                when {
                                    message.answer.isNotBlank() -> "AU"
                                    message.generating -> "AU is thinking"
                                    message.overview -> "Overview · source excerpts"
                                    message.semantic -> "Semantic matches from your document"
                                    else -> "Matches from your document"
                                },
                                fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface
                            )
                            if (message.corrected.isNotEmpty()) {
                                Text("Matched: " + message.corrected.entries.joinToString { "${it.key} → ${it.value}" },
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    style = MaterialTheme.typography.labelSmall)
                            }
                            Spacer(Modifier.height(8.dp))
                            if (message.answer.isNotBlank()) {
                                ClickableText(
                                    text = AnnotatedString(message.answer),
                                    style = MaterialTheme.typography.bodyLarge.copy(
                                        color = MaterialTheme.colorScheme.onSurface
                                    ),
                                    onClick = { offset ->
                                        val term = SourceTermGrounding.wordAt(message.answer, offset)
                                        val source = term?.let { key ->
                                            SourceTermGrounding.find(
                                                key, message.matches.map { RagEvidence(it.text, it.page) }
                                            )
                                        }
                                        if (source != null) {
                                            termRequest?.cancel()
                                            termExplanation = ""
                                            tappedTerm = source
                                        }
                                    }
                                )
                                Spacer(Modifier.height(8.dp))
                            }
                            if (message.generating) {
                                LinearProgressIndicator(Modifier.fillMaxWidth())
                                Spacer(Modifier.height(8.dp))
                            }
                            if (message.generationError != null) {
                                Text(message.generationError,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    style = MaterialTheme.typography.bodySmall)
                                Spacer(Modifier.height(8.dp))
                            }
                            if (message.matches.isEmpty()) {
                                Text("No supported source passage found. Try asking about a specific section.",
                                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                            } else {
                                val turnIndex = messages.indexOf(message)
                                TextButton(onClick = {
                                    expandedSources = if (turnIndex in expandedSources) expandedSources - turnIndex
                                    else expandedSources + turnIndex
                                }) {
                                    Icon(Icons.Outlined.MenuBook, null, Modifier.size(17.dp))
                                    Spacer(Modifier.width(5.dp))
                                    Text("Sources (${message.matches.size})")
                                    Icon(
                                        if (turnIndex in expandedSources) Icons.Outlined.ExpandLess
                                        else Icons.Outlined.ExpandMore,
                                        contentDescription = null
                                    )
                                }
                                if (turnIndex in expandedSources) {
                                message.matches.forEachIndexed { index, snippet ->
                                    val phrase = message.question.split(Regex("[^\\p{L}\\p{N}]+"))
                                        .filter { it.length >= 4 }.distinct().take(8)
                                    val highlightColor = MaterialTheme.colorScheme.primaryContainer
                                    val highlighted = buildAnnotatedString {
                                        append(snippet.text)
                                        phrase.forEach { term ->
                                            Regex(Regex.escape(term), RegexOption.IGNORE_CASE)
                                                .findAll(snippet.text).take(10).forEach { match ->
                                                    addStyle(
                                                        SpanStyle(background = highlightColor),
                                                        match.range.first, match.range.last + 1
                                                    )
                                                }
                                        }
                                    }
                                    SelectionContainer {
                                        Text(highlighted, color = MaterialTheme.colorScheme.onSurface,
                                            style = MaterialTheme.typography.bodyMedium)
                                    }
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Icon(Icons.Outlined.Description, contentDescription = null,
                                            tint = MaterialTheme.colorScheme.primary,
                                            modifier = Modifier.size(15.dp))
                                        Spacer(Modifier.width(5.dp))
                                        TextButton(onClick = { openedEvidence = snippet }) {
                                            Text(snippet.page?.let { "[${index + 1}] Page $it · View source" } ?: "[${index + 1}] View source")
                                        }
                                    }
                                    if (index != message.matches.lastIndex) {
                                        HorizontalDivider(Modifier.padding(vertical = 8.dp),
                                            color = MaterialTheme.colorScheme.outlineVariant)
                                    }
                                }
                                }
                            }
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                TextButton(onClick = {
                                    clipboard.setText(AnnotatedString(
                                        if (message.answer.isNotBlank()) message.answer
                                        else message.matches.joinToString("\n\n") { evidence ->
                                            evidence.text + (evidence.page?.let { "\nPage $it" } ?: "")
                                        }
                                    ))
                                }) {
                                    Icon(Icons.Outlined.ContentCopy, null, Modifier.size(17.dp))
                                    Spacer(Modifier.width(5.dp))
                                    Text("Copy")
                                }
                                Spacer(Modifier.weight(1f))
                                TextButton(onClick = {
                                    expandedSteps = if (message.steps.isEmpty()) expandedSteps
                                    else if (messages.indexOf(message) in expandedSteps) {
                                        expandedSteps - messages.indexOf(message)
                                    } else expandedSteps + messages.indexOf(message)
                                }) {
                                    Icon(Icons.Outlined.AccountTree, null, Modifier.size(17.dp))
                                    Spacer(Modifier.width(5.dp))
                                    Text("AU activity")
                                }
                            }
                            if (messages.indexOf(message) in expandedSteps) {
                                AuActivityTimeline(message.steps)
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
        AuComposer(
            value = prompt,
            onValueChange = { prompt = it.take(500) },
            onSend = { submitQuestion(prompt.trim()) },
            placeholder = "Ask AU about this document…",
            enabled = historyReady && threadIndex != null && !session.searching,
            sendEnabled = historyReady && threadIndex != null &&
                userTurns < ConversationWindow.MAX_USER_TURNS && prompt.isNotBlank() &&
                !textPreview.isNullOrBlank() && !session.searching,
            sendDescription = "Search document",
            actions = {
                VoiceNoteInputButton(
                    ownerId = documentId,
                    enabled = historyReady && !session.searching && threadIndex != null &&
                        userTurns < ConversationWindow.MAX_USER_TURNS,
                    supportsAudio = LocalGenerativeEngine.supportsVoiceNotes(context),
                    onReady = { note ->
                        val label = "Voice note · " + note.durationSeconds + "s"
                        messages.add(ChatMessage(label, emptyList(), true,
                            audioPath = note.file.absolutePath))
                        session.searching = true
                        session.searchingStage = "AU is listening"
                        session.activeRequest = session.scope.launch {
                            try {
                                val words = LocalGenerativeEngine.understandVoiceNote(context, note.file)
                                session.searching = false
                                session.searchingStage = ""
                                submitQuestion(words, label, note.file.absolutePath, alreadyAdded = true)
                            } catch (cancelled: CancellationException) {
                                session.searching = false
                                session.searchingStage = ""
                                throw cancelled
                            } catch (error: Exception) {
                                session.searching = false
                                session.searchingStage = ""
                                messages.add(ChatMessage(label, emptyList(), false,
                                    generationError = error.message ?: "AU could not understand the audio."))
                            }
                        }
                    }
                )
            }
        )
    }
}

@Composable
fun SmartNoteWorkspace(documentName: String, textPreview: String?, previewLoading: Boolean) {
    var selectedView by remember(documentName) { mutableIntStateOf(1) }
    val topics = remember(textPreview) { documentTopics(textPreview) }
    val summary = remember(textPreview) { documentSummary(textPreview) }
    val snippets = remember(textPreview) { sourceSnippets(textPreview) }
    val clipboard = LocalClipboardManager.current
    var selectedSource by remember(documentName) { mutableStateOf<SourceSnippet?>(null) }

    selectedSource?.let { evidence ->
        DataCubeDialog(
            onDismissRequest = { selectedSource = null },
            title = { Text(evidence.page?.let { "Source · Page $it" } ?: "Source") },
            text = {
                Column(Modifier.heightIn(max = 320.dp).verticalScroll(rememberScrollState())) {
                    SelectionContainer { Text(evidence.text) }
                }
            },
            confirmButton = { TextButton(onClick = { selectedSource = null }) { Text("Done") } },
            dismissButton = {
                TextButton(onClick = { clipboard.setText(AnnotatedString(evidence.text)) }) { Text("Copy") }
            }
        )
    }

    ToolPage("Smart Note", "Organize key ideas extracted from $documentName. Content stays on this device.") {
        if (textPreview.isNullOrBlank()) SourceUnavailableCard(previewLoading, null) else {
            // Two full-width targets without icons: on narrow phones the
            // SegmentedButton default checkmark and icon collided with labels.
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                listOf("Concept map", "Study notes").forEachIndexed { index, title ->
                    Surface(
                        onClick = { selectedView = index },
                        modifier = Modifier.weight(1f),
                        shape = RoundedCornerShape(14.dp),
                        color = if (selectedView == index) MaterialTheme.colorScheme.primaryContainer
                            else MaterialTheme.colorScheme.surface,
                        border = BorderStroke(
                            1.dp,
                            if (selectedView == index) MaterialTheme.colorScheme.primary
                                else MaterialTheme.colorScheme.outlineVariant
                        )
                    ) {
                        Text(
                            title,
                            Modifier.padding(vertical = 14.dp, horizontal = 8.dp),
                            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                            color = if (selectedView == index) MaterialTheme.colorScheme.onPrimaryContainer
                                else MaterialTheme.colorScheme.onSurface,
                            fontWeight = FontWeight.SemiBold,
                            maxLines = 1
                        )
                    }
                }
            }
            if (selectedView == 1) {
                ToolCard {
                    Text("Study notes", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)
                    Text("Extracted from $documentName", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(Modifier.height(12.dp))
                    Text("Key ideas from the document", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)
                    Text(summary.ifBlank { "No readable passages were extracted." }, color = MaterialTheme.colorScheme.onSurface)
                }
                topics.forEachIndexed { index, topic ->
                    ToolCard {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Surface(shape = RoundedCornerShape(50), color = MaterialTheme.colorScheme.primaryContainer) {
                                Text((index + 1).toString(), Modifier.padding(horizontal = 11.dp, vertical = 6.dp), color = MaterialTheme.colorScheme.onPrimaryContainer, fontWeight = FontWeight.Bold)
                            }
                            Spacer(Modifier.width(9.dp))
                            Text(topic, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)
                        }
                        snippets.firstOrNull { it.text.contains(topic, ignoreCase = true) }?.let { evidence ->
                            Spacer(Modifier.height(8.dp))
                            Text(evidence.text, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 4)
                            TextButton(onClick = { selectedSource = evidence }) {
                                Text(evidence.page?.let { "View page $it" } ?: "View source")
                            }
                        }
                    }
                }
                ToolCard {
                    Text("Source", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)
                    Text("These are extractive study aids built from available text, not an AI paraphrase.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            } else {
                ToolCard {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Outlined.AccountTree, contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary)
                        Spacer(Modifier.width(8.dp))
                        Text("Concept map", style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.Bold)
                    }
                    Text("Tap a concept to see its passage.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(Modifier.height(14.dp))
                    Surface(
                        shape = RoundedCornerShape(18.dp),
                        color = MaterialTheme.colorScheme.primaryContainer
                    ) {
                        Column(Modifier.fillMaxWidth().padding(16.dp),
                            horizontalAlignment = Alignment.CenterHorizontally) {
                            Icon(Icons.Outlined.MenuBook, null,
                                tint = MaterialTheme.colorScheme.primary)
                            Text(documentName, maxLines = 2, textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                                fontWeight = FontWeight.Bold)
                        }
                    }
                    if (topics.isEmpty()) {
                        Text("No concepts detected in the available source text.",
                            style = MaterialTheme.typography.bodySmall)
                    } else {
                        val lineColor = MaterialTheme.colorScheme.primary
                        Canvas(Modifier.fillMaxWidth().height(26.dp)) {
                            val midpoint = size.width / 2f
                            drawLine(lineColor, Offset(midpoint, 0f), Offset(midpoint, size.height), 2.dp.toPx())
                            drawCircle(lineColor, radius = 4.dp.toPx(), center = Offset(midpoint, size.height))
                        }
                        Row(
                            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                            horizontalArrangement = Arrangement.spacedBy(10.dp)
                        ) {
                            topics.take(10).forEachIndexed { index, topic ->
                                val evidence = snippets.firstOrNull { it.text.contains(topic, ignoreCase = true) }
                                OutlinedCard(
                                    onClick = { if (evidence != null) selectedSource = evidence },
                                    enabled = evidence != null,
                                    modifier = Modifier.width(174.dp),
                                    shape = RoundedCornerShape(16.dp)
                                ) {
                                    Column(Modifier.padding(13.dp),
                                        verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                        Row(verticalAlignment = Alignment.CenterVertically) {
                                            Text("${index + 1}", color = MaterialTheme.colorScheme.primary,
                                                fontWeight = FontWeight.Bold)
                                            Spacer(Modifier.weight(1f))
                                            Icon(Icons.Outlined.Hub, null,
                                                tint = MaterialTheme.colorScheme.primary,
                                                modifier = Modifier.size(18.dp))
                                        }
                                        Text(topic, fontWeight = FontWeight.SemiBold, maxLines = 3)
                                        Text(evidence?.page?.let { "Page $it · Open" }
                                            ?: "No linked page",
                                            style = MaterialTheme.typography.labelSmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    }
                                }
                            }
                        }
                        Text("Concepts come from extracted text; diagrams are not generated illustrations.",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }
}

@Composable
fun PredictionWorkspace(documentName: String, textPreview: String?, previewLoading: Boolean) {
    var generated by remember(documentName) { mutableStateOf(false) }
    val topics = remember(textPreview) { documentTopics(textPreview) }
    val questions = remember(textPreview) { suggestedStudyQuestions(textPreview, 8) }

    ToolPage("Prediction", "Build a focused revision plan from the themes and passages in your notes.") {
        if (textPreview.isNullOrBlank()) SourceUnavailableCard(previewLoading, null) else {
            ToolCard {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.Description, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text(documentName, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)
                        Text(sourceSnippets(textPreview).size.toString() + " readable passages found", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Icon(Icons.Outlined.CheckCircle, contentDescription = "Document ready", tint = MaterialTheme.colorScheme.primary)
                }
                Spacer(Modifier.height(14.dp))
                Button(onClick = { generated = true }, Modifier.fillMaxWidth().heightIn(min = 50.dp)) {
                    Text(if (generated) "Refresh Study Plan" else "Generate Study Plan")
                }
            }
            if (generated) {
                ToolCard {
                    Text("Key topics to focus on", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)
                    Text("Topics are identified from headings and repeated terms; they are not exam-probability scores.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(Modifier.height(12.dp))
                    topics.forEachIndexed { index, topic ->
                        Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text((index + 1).toString() + ".", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
                            Spacer(Modifier.width(8.dp)); Text(topic, Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurface, fontWeight = FontWeight.SemiBold)
                            AssistChip(onClick = {}, enabled = false, label = { Text("Review") })
                        }
                    }
                    if (topics.isEmpty()) Text("No distinct topics could be identified from this text.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                ToolCard {
                    Text("Suggested revision questions", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)
                    questions.take(5).forEachIndexed { index, question ->
                        Column(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
                            Text((index + 1).toString() + ". " + question.prompt, color = MaterialTheme.colorScheme.onSurface, fontWeight = FontWeight.Medium)
                            Text(question.page?.let { "Source: page $it" } ?: "Source: extracted document text", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelSmall)
                        }
                        if (index != questions.take(5).lastIndex) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    }
                }
            } else {
                ToolCard {
                    Text("What this plan uses", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)
                    Text("The plan is derived from detected headings, recurring terms and readable passages. It does not claim to predict an actual exam.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}

@Composable
fun PracticeWorkspace(documentName: String, textPreview: String?, previewLoading: Boolean) {
    var questionCount by remember(documentName) { mutableIntStateOf(5) }
    var questionStyle by remember(documentName) { mutableStateOf("Explain") }
    var focus by remember(documentName) { mutableStateOf("All topics") }
    var started by remember(documentName) { mutableStateOf(false) }
    var currentIndex by remember(documentName) { mutableIntStateOf(0) }
    var answers by remember(documentName) { mutableStateOf<Map<Int, String>>(emptyMap()) }
    var showReference by remember(documentName) { mutableStateOf(false) }
    var completed by remember(documentName) { mutableStateOf(false) }
    val answer = answers[currentIndex].orEmpty()
    val topics = remember(textPreview) { documentTopics(textPreview) }
    val questions = remember(textPreview, questionCount, questionStyle, focus) {
        val all = suggestedStudyQuestions(textPreview, questionCount)
        val filtered = if (focus == "All topics") all else all.filter { it.topic.equals(focus, ignoreCase = true) }
        (filtered.ifEmpty { all }).take(questionCount)
    }

    ToolPage("Practice", "Test your understanding with questions based on this document.") {
        if (textPreview.isNullOrBlank()) SourceUnavailableCard(previewLoading, null)
        else if (questions.isEmpty()) {
            ToolCard {
                Text("No readable passages found", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)
                Text(
                    "There is not enough readable extracted text to create practice questions. Check the document extraction status or choose a document with readable text.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
        else if (!started) {
            ToolCard {
                Text("Practice setup", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)
                Spacer(Modifier.height(14.dp))
                Text("Question count", fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurface)
                ChoiceDropdown("$questionCount questions", listOf("5 questions", "10 questions", "15 questions")) {
                    questionCount = it.substringBefore(' ').toIntOrNull() ?: 5
                }
                Spacer(Modifier.height(10.dp))
                Text("Question style", fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurface)
                ChoiceDropdown(questionStyle, listOf("Explain", "Recall")) { questionStyle = it }
                Spacer(Modifier.height(10.dp))
                Text("Focus area", fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurface)
                ChoiceDropdown(focus, listOf("All topics") + topics) { focus = it }
                Spacer(Modifier.height(16.dp))
                Button(onClick = { started = true; completed = false; currentIndex = 0; answers = emptyMap(); showReference = false }, Modifier.fillMaxWidth().heightIn(min = 52.dp)) {
                    Icon(Icons.Outlined.PlayArrow, contentDescription = null); Spacer(Modifier.width(8.dp)); Text("Start Practice")
                }
            }
            Text("Questions are built from locally extracted text. Reference passages support self-checking; responses are not automatically graded.", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
        } else if (completed) {
            ToolCard {
                Icon(Icons.Outlined.CheckCircle, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(40.dp))
                Text("Practice complete", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)
                Text(answers.values.count { it.isNotBlank() }.toString() + " of " + questions.size + " questions answered.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(12.dp))
                Text("Your answers remain available in this review until you restart the session.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Button(onClick = { completed = false; started = false; currentIndex = 0 }, Modifier.fillMaxWidth()) { Text("Practice Again") }
            }
            questions.forEachIndexed { index, question ->
                ToolCard {
                    Text("Question " + (index + 1), fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)
                    Text(question.prompt, color = MaterialTheme.colorScheme.onSurface)
                    Text(answers[index].orEmpty().ifBlank { "No answer entered." }, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        } else {
            val question = questions.getOrNull(currentIndex)
            ToolCard {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Question " + (currentIndex + 1) + " of " + questions.size, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)
                    Spacer(Modifier.weight(1f)); Text(question?.topic.orEmpty(), color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelMedium)
                }
                Spacer(Modifier.height(10.dp))
                LinearProgressIndicator(
                    progress = { if (questions.isEmpty()) 0f else (currentIndex + 1).toFloat() / questions.size },
                    Modifier.fillMaxWidth()
                )
                Spacer(Modifier.height(18.dp))
                Text(
                    question?.let { if (questionStyle == "Recall") "What do your notes say about " + it.topic + "?" else it.prompt }
                        ?: "There is not enough extracted text to build a practice question.",
                    style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface
                )
                Spacer(Modifier.height(14.dp))
                OutlinedTextField(value = answer, onValueChange = { updated -> answers = answers + (currentIndex to updated) }, modifier = Modifier.fillMaxWidth(), minLines = 3, label = { Text("Your answer") }, placeholder = { Text("Write your response here…") })
                Spacer(Modifier.height(10.dp))
                OutlinedButton(onClick = { showReference = !showReference }, Modifier.fillMaxWidth(), enabled = question != null) {
                    Icon(Icons.Outlined.MenuBook, contentDescription = null); Spacer(Modifier.width(7.dp))
                    Text(if (showReference) "Hide source passage" else "Show source passage")
                }
                if (showReference && question != null) {
                    HorizontalDivider(Modifier.padding(vertical = 10.dp), color = MaterialTheme.colorScheme.outlineVariant)
                    Text("Reference from your document", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)
                    Text(question.reference, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(question.page?.let { "Page $it" } ?: "Local extracted text", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
                }
                Spacer(Modifier.height(14.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                    OutlinedButton(
                        onClick = { currentIndex = (currentIndex - 1).coerceAtLeast(0); showReference = false },
                        enabled = currentIndex > 0, modifier = Modifier.weight(1f)
                    ) { Text("Previous") }
                    Button(
                        onClick = {
                            if (currentIndex < questions.lastIndex) {
                                currentIndex += 1
                                showReference = false
                            } else completed = true
                        },
                        Modifier.weight(1f)
                    ) { Text(if (currentIndex == questions.lastIndex) "Finish" else "Next") }
                }
            }
        }
    }
}

@Composable
private fun ChoiceDropdown(value: String, options: List<String>, onSelect: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Box(Modifier.fillMaxWidth()) {
        OutlinedButton(onClick = { expanded = true }, Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp), contentPadding = PaddingValues(horizontal = 14.dp, vertical = 12.dp)) {
            Text(value, Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurface)
            Icon(Icons.Outlined.ArrowDropDown, contentDescription = "Choose $value")
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            options.forEach { option -> DropdownMenuItem(text = { Text(option) }, onClick = { onSelect(option); expanded = false }) }
        }
    }
}

@Composable
fun PodcastWorkspace(documentId: String, documentName: String, textPreview: String?, previewLoading: Boolean) {
    val context = LocalContext.current
    val narratorScope = rememberCoroutineScope()
    val neuralInstalled = remember(context) { NeuralNarration.installed(context) }
    val neuralPrefs = remember(context) {
        context.getSharedPreferences("datacube_neural_voice", android.content.Context.MODE_PRIVATE)
    }
    var useNeural by remember(context) {
        mutableStateOf(neuralInstalled && neuralPrefs.getBoolean("enabled", true))
    }
    var neuralVoice by remember(context) {
        mutableStateOf(neuralPrefs.getString("voice", NeuralNarration.DEFAULT_VOICE)
            ?: NeuralNarration.DEFAULT_VOICE)
    }
    var neuralJob by remember { mutableStateOf<Job?>(null) }
    var speechReady by remember { mutableStateOf(false) }
    var speaking by remember { mutableStateOf(false) }
    var speechError by remember { mutableStateOf<String?>(null) }
    var neuralStage by remember { mutableStateOf("") }
    var activeChapter by remember(documentName) { mutableIntStateOf(0) }
    var podcastMode by remember(documentId) { mutableIntStateOf(0) }
    val voicePreferences = remember(context) { OfflineNarrationPreferences(context) }
    var speechRate by remember { mutableFloatStateOf(voicePreferences.speed) }
    var speechPitch by remember { mutableFloatStateOf(voicePreferences.pitch) }
    var selectedVoiceName by remember { mutableStateOf(voicePreferences.voiceName) }
    var offlineVoices by remember { mutableStateOf<List<Voice>>(emptyList()) }
    val narrationReady = if (useNeural) neuralInstalled else speechReady && offlineVoices.isNotEmpty()
    var voiceMenuExpanded by remember { mutableStateOf(false) }
    var voiceRefresh by remember { mutableIntStateOf(0) }
    val snippets = remember(textPreview) { sourceSnippets(textPreview) }
    val chapters = remember(textPreview) {
        snippets.chunked(5).mapIndexed { index, group ->
            val chapterTitles = listOf("Overview & key ideas", "Main concepts", "Examples & applications", "Key takeaways", "Summary & next steps")
            SourceSnippet(group.joinToString(" ") { it.text }.take(2_000), group.firstOrNull()?.page) to
                chapterTitles.getOrElse(index) { "Section " + (index + 1) }
        }.take(5)
    }
    val summary = remember(textPreview) { documentSummary(textPreview) }
    val tts = remember(context) {
        TextToSpeech(context.applicationContext) { status ->
            speechReady = status == TextToSpeech.SUCCESS
            if (status != TextToSpeech.SUCCESS && !useNeural) {
                speechError = "The Android offline speech engine could not be initialized."
            }
        }
    }

    DisposableEffect(tts) {
        tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) { speaking = true }
            override fun onDone(utteranceId: String?) { speaking = false }
            override fun onError(utteranceId: String?) {
                speaking = false
                speechError = "Narration could not be played by the installed speech engine."
            }
        })
        onDispose {
            neuralJob?.cancel()
            NeuralNarration.stop()
            kotlinx.coroutines.CoroutineScope(Dispatchers.IO).launch { NeuralNarration.release() }
            tts.stop()
            tts.shutdown()
        }
    }

    LaunchedEffect(tts, speechReady, voiceRefresh) {
        if (speechReady) {
            offlineVoices = runCatching {
                tts.voices.orEmpty()
                    .filter { !it.isNetworkConnectionRequired }
                    .sortedWith(
                        compareByDescending<Voice> { it.locale.language == Locale.getDefault().language }
                            .thenBy { it.locale.displayLanguage }
                            .thenBy { it.name }
                    )
            }.getOrDefault(emptyList())
            if (offlineVoices.isEmpty()) {
                speechError = "No offline voices installed. Download an offline voice in Android speech settings."
            } else {
                val match = offlineVoices.firstOrNull { it.name == selectedVoiceName }
                    ?: offlineVoices.first()
                if (selectedVoiceName != match.name) {
                    selectedVoiceName = match.name
                    voicePreferences.voiceName = match.name
                }
                speechError = null
            }
        }
    }

    fun speak(text: String) {
        if (text.isBlank()) return
        if (useNeural) {
            if (!neuralInstalled) {
                speechError = "Download Kokoro in Settings → Models."
                return
            }
            neuralJob?.cancel()
            NeuralNarration.stop()
            tts.stop()
            speechError = null
            neuralStage = "Preparing Kokoro on your device"
            speaking = true
            neuralJob = narratorScope.launch {
                try {
                    NeuralNarration.speak(context, text, neuralVoice, speechRate) { stage ->
                        withContext(Dispatchers.Main) { neuralStage = stage }
                    }
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (error: Exception) {
                    speechError = "Kokoro neural playback failed: " +
                        (error.message ?: "The model or device runtime could not synthesize audio.")
                } finally {
                    neuralStage = ""
                    speaking = false
                }
            }
            return
        }
        if (!speechReady) return
        val voice = offlineVoices.firstOrNull { it.name == selectedVoiceName }
        if (voice == null) {
            speechError = "Select an installed offline voice first."
            return
        }
        tts.stop()
        if (tts.setVoice(voice) == TextToSpeech.ERROR) {
            speechError = "This offline voice is unavailable. Try another voice."
            return
        }
        tts.setSpeechRate(speechRate)
        tts.setPitch(speechPitch)
        speechError = null
        val result = tts.speak(text.take(4_000), TextToSpeech.QUEUE_FLUSH, null, "datacube-document-audio")
        if (result == TextToSpeech.ERROR) {
            speaking = false
            speechError = "Narration could not be started."
        } else speaking = true
    }

    ToolPage("Podcast", "Review $documentName through a guided conversation or a narrated summary.") {
        if (textPreview.isNullOrBlank()) SourceUnavailableCard(previewLoading, null)
        else {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                listOf("Conversation", "Narration").forEachIndexed { index, title ->
                    Surface(
                        onClick = { podcastMode = index },
                        modifier = Modifier.weight(1f),
                        shape = RoundedCornerShape(18.dp),
                        color = if (podcastMode == index)
                            MaterialTheme.colorScheme.primaryContainer
                        else MaterialTheme.colorScheme.surface,
                        border = BorderStroke(1.dp,
                            if (podcastMode == index) MaterialTheme.colorScheme.primary
                            else MaterialTheme.colorScheme.outlineVariant)
                    ) {
                        Text(title,
                            Modifier.padding(vertical = 14.dp, horizontal = 6.dp),
                            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                            fontWeight = FontWeight.SemiBold,
                            color = if (podcastMode == index)
                                MaterialTheme.colorScheme.onPrimaryContainer
                            else MaterialTheme.colorScheme.onSurface)
                    }
                }
            }
            if (podcastMode == 0) {
                PodcastConversationPanel(
                    documentId = documentId,
                    documentName = documentName,
                    textPreview = textPreview,
                    playbackSpeed = speechRate
                )
            } else {
            ToolCard {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Surface(shape = RoundedCornerShape(18.dp), color = MaterialTheme.colorScheme.primaryContainer) {
                        Icon(Icons.Outlined.GraphicEq, contentDescription = "Audio summary", tint = MaterialTheme.colorScheme.onPrimaryContainer, modifier = Modifier.size(78.dp).padding(20.dp))
                    }
                    Spacer(Modifier.width(14.dp))
                    Column(Modifier.weight(1f)) {
                        Text("$documentName · Audio Summary", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)
                        Text(chapters.size.toString() + " chapters · Text-to-speech", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                        Text(
                            if (speaking) {
                                if (useNeural) neuralStage.ifBlank { "Preparing neural voice" }
                                else "Android offline narration playing"
                            } else "Ready to play",
                            color = MaterialTheme.colorScheme.primary,
                            style = MaterialTheme.typography.labelMedium
                        )
                    }
                }
                Spacer(Modifier.height(16.dp))
                Text("Voice engine", fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurface)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(
                        selected = !useNeural,
                        onClick = {
                            neuralJob?.cancel()
                            NeuralNarration.stop()
                            useNeural = false
                            neuralPrefs.edit().putBoolean("enabled", false).apply()
                            speaking = false
                        },
                        label = { Text("Android offline") }
                    )
                    FilterChip(
                        selected = useNeural,
                        enabled = neuralInstalled,
                        onClick = {
                            tts.stop()
                            useNeural = true
                            neuralPrefs.edit().putBoolean("enabled", true).apply()
                            speaking = false
                        },
                        label = { Text("Kokoro neural") }
                    )
                }
                if (!neuralInstalled) {
                    Text("Kokoro: optional download in Settings → Models",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodySmall)
                }
                Text("Voice", fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurface)
                Spacer(Modifier.height(6.dp))
                Box(Modifier.fillMaxWidth()) {
                    OutlinedButton(
                        onClick = { voiceMenuExpanded = true },
                        enabled = if (useNeural) neuralInstalled else speechReady && offlineVoices.isNotEmpty(),
                        modifier = Modifier.fillMaxWidth(),
                        contentPadding = PaddingValues(horizontal = 14.dp, vertical = 12.dp)
                    ) {
                        Icon(Icons.Outlined.RecordVoiceOver, contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text(
                            if (useNeural)
                                NeuralNarration.presetVoices[neuralVoice] ?: "Select Kokoro voice"
                            else offlineVoices.firstOrNull { it.name == selectedVoiceName }?.let { voice ->
                                "${voice.locale.displayName} · ${voice.name}"
                            } ?: "No installed offline voices",
                            Modifier.weight(1f),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        Icon(Icons.Outlined.ArrowDropDown, contentDescription = "Choose offline voice")
                    }
                    DropdownMenu(
                        expanded = voiceMenuExpanded,
                        onDismissRequest = { voiceMenuExpanded = false }
                    ) {
                        if (useNeural) {
                            NeuralNarration.presetVoices.forEach { (id, label) ->
                                DropdownMenuItem(
                                    text = { Text(label) },
                                    onClick = {
                                        neuralJob?.cancel()
                                        NeuralNarration.stop()
                                        speaking = false
                                        neuralVoice = id
                                        neuralPrefs.edit().putString("voice", id).apply()
                                        voiceMenuExpanded = false
                                    },
                                    leadingIcon = {
                                        if (id == neuralVoice) Icon(Icons.Outlined.Check, null)
                                    }
                                )
                            }
                        } else offlineVoices.forEach { voice ->
                            DropdownMenuItem(
                                text = { Text("${voice.locale.displayName} · ${voice.name}", maxLines = 2) },
                                onClick = {
                                    tts.stop()
                                    speaking = false
                                    selectedVoiceName = voice.name
                                    voicePreferences.voiceName = voice.name
                                    voiceMenuExpanded = false
                                },
                                leadingIcon = {
                                    if (voice.name == selectedVoiceName) Icon(Icons.Outlined.Check, contentDescription = null)
                                }
                            )
                        }
                    }
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(if (useNeural) "Offline neural · 4 voices"
                        else "${offlineVoices.size} installed voices", style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
                    TextButton(
                        onClick = { voiceRefresh += 1 },
                        enabled = !useNeural && speechReady
                    ) { Text("Refresh voices") }
                    TextButton(
                        onClick = { speak("Welcome to DataCube AU. Let's review your study notes.") },
                        enabled = if (useNeural) neuralInstalled else speechReady && offlineVoices.isNotEmpty()
                    ) { Text("Preview") }
                }
                Text("Narration speed", fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurface)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf(0.8f, 1.0f, 1.2f).forEach { rate ->
                        FilterChip(
                            selected = speechRate == rate,
                            onClick = {
                                speechRate = rate
                                voicePreferences.speed = rate
                                if (speaking) speak(chapters.getOrNull(activeChapter)?.first?.text ?: summary)
                            },
                            label = { Text(rate.toString() + "x") }
                        )
                    }
                }
                if (!useNeural) {
                Text("Voice tone", fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurface)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf(0.9f, 1.0f, 1.1f).forEach { pitch ->
                        FilterChip(
                            selected = speechPitch == pitch,
                            onClick = {
                                speechPitch = pitch
                                voicePreferences.pitch = pitch
                                if (speaking) speak(chapters.getOrNull(activeChapter)?.first?.text ?: summary)
                            },
                            label = { Text(when (pitch) { 0.9f -> "Lower"; 1.1f -> "Higher"; else -> "Normal" }) }
                        )
                    }
                }
                }
                Spacer(Modifier.height(14.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Button(
                        onClick = {
                            if (speaking) {
                                neuralJob?.cancel()
                                NeuralNarration.stop()
                                tts.stop()
                                speaking = false
                            }
                            else speak(chapters.getOrNull(activeChapter)?.first?.text ?: summary)
                        },
                        enabled = narrationReady && summary.isNotBlank(),
                        modifier = Modifier.weight(1f).heightIn(min = 50.dp)
                    ) {
                        Icon(if (speaking) Icons.Outlined.Stop else Icons.Outlined.PlayArrow, contentDescription = null)
                        Spacer(Modifier.width(7.dp)); Text(if (speaking) "Stop narration" else "Play summary")
                    }
                    OutlinedButton(onClick = { activeChapter = 0; speak(summary) }, enabled = narrationReady && summary.isNotBlank()) { Text("Full summary") }
                }
                speechError?.let { Spacer(Modifier.height(8.dp)); Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
                if (!useNeural && !speechReady && speechError == null) {
                    Spacer(Modifier.height(8.dp)); Text("Preparing the installed Android speech engine…", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                }
                Text(
                    "Kokoro plays only through the downloaded neural model. No automatic Android-voice fallback. If neural synthesis fails, review the error above.",
                    Modifier.padding(top = 10.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            ToolCard {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Chapters", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)
                    Spacer(Modifier.weight(1f)); Text(chapters.size.toString() + " sections", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                }
                chapters.forEachIndexed { index, chapter ->
                    Surface(
                        onClick = { activeChapter = index; speak(chapter.first.text) },
                        shape = RoundedCornerShape(14.dp),
                        color = if (activeChapter == index) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface,
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant), enabled = narrationReady
                    ) {
                        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 13.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(if (activeChapter == index && speaking) Icons.Outlined.VolumeUp else Icons.Outlined.PlayArrow, contentDescription = "Play " + chapter.second, tint = MaterialTheme.colorScheme.primary)
                            Spacer(Modifier.width(10.dp))
                            Column(Modifier.weight(1f)) {
                                Text(chapter.second, color = MaterialTheme.colorScheme.onSurface, fontWeight = FontWeight.SemiBold)
                                Text(chapter.first.page?.let { "Starts near page $it" } ?: "Extracted document passage", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelSmall)
                            }
                        }
                    }
                    if (index != chapters.lastIndex) Spacer(Modifier.height(8.dp))
                }
            }
            ToolCard {
                Text("Audio summary text", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)
                Spacer(Modifier.height(7.dp)); Text(summary, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            }
        }
    }
}
