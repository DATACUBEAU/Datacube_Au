package au.datacube.app.ui.documents

import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import au.datacube.app.data.LocalJobStatus
import au.datacube.app.ui.theme.DataCubeColors
import java.util.Locale

private data class SourceSnippet(val text: String, val page: Int?)
private data class StudyQuestion(val prompt: String, val reference: String, val page: Int?, val topic: String)
private data class ChatMessage(val question: String, val matches: List<SourceSnippet>, val isUser: Boolean)

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
                !line.startsWith("Page ", ignoreCase = true)
        }
        .distinctBy { it.lowercase() }.take(5).toList()

    val frequentTerms = Regex("[\\p{L}][\\p{L}'’-]{4,}")
        .findAll(content.lowercase())
        .map { it.value.trim('’', '\'', '-') }
        .filterNot { it in ignoredTerms }
        .groupingBy { it }.eachCount().entries
        .sortedByDescending { it.value }
        .map { it.key.replaceFirstChar { char -> char.titlecase(Locale.getDefault()) } }
        .filterNot { candidate -> headings.any { it.equals(candidate, ignoreCase = true) } }
        .take(6)
    return (headings + frequentTerms).distinctBy { it.lowercase() }.take(8)
}

private fun documentSummary(raw: String?): String =
    sourceSnippets(raw).take(4).joinToString(" ") { it.text }.take(1_200)

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
    val terms = Regex("[\\p{L}\\p{N}]{3,}").findAll(query.lowercase())
        .map { it.value }.filterNot { it in ignoredTerms }.toSet()
    if (terms.isEmpty()) return emptyList()
    return sourceSnippets(raw).map { snippet ->
        val words = Regex("[\\p{L}\\p{N}]{3,}").findAll(snippet.text.lowercase()).map { it.value }.toSet()
        snippet to terms.count { it in words }
    }.filter { it.second > 0 }
        .sortedWith(compareByDescending<Pair<SourceSnippet, Int>> { it.second }.thenByDescending { it.first.text.length })
        .map { it.first }.distinctBy { it.text }.take(4)
}

@Composable
private fun ToolPage(title: String, subtitle: String, content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(title, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
            Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = DataCubeColors.TextSecondary)
        }
        content()
    }
}

@Composable
private fun ToolCard(content: @Composable ColumnScope.() -> Unit) {
    Surface(
        Modifier.fillMaxWidth(), shape = RoundedCornerShape(20.dp), color = Color.White,
        border = BorderStroke(1.dp, DataCubeColors.Divider), tonalElevation = 1.dp
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
            Icon(Icons.Outlined.Description, contentDescription = null, tint = DataCubeColors.Blue)
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text("Waiting for extracted document text", fontWeight = FontWeight.SemiBold, color = DataCubeColors.Navy)
                Text(
                    when {
                        previewLoading -> "Loading the private on-device text preview."
                        previewError != null -> previewError
                        extractionStatus == LocalJobStatus.RUNNING -> "Extraction is running on this device."
                        extractionStatus == LocalJobStatus.QUEUED || extractionStatus == LocalJobStatus.RETRYABLE -> "Local extraction is queued."
                        extractionStatus == LocalJobStatus.FAILED -> extractionError ?: "Local extraction failed."
                        else -> "Import a supported file and let local extraction finish."
                    },
                    style = MaterialTheme.typography.bodySmall, color = DataCubeColors.TextSecondary
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
            style = MaterialTheme.typography.bodySmall, color = DataCubeColors.TextSecondary
        )
    }
}

@Composable
fun DocumentChatWorkspace(
    documentName: String, initialPrompt: String? = null, textPreview: String?, previewLoading: Boolean, previewError: String?,
    extractionStatus: String?, extractionProgress: Double?, extractionError: String?
) {
    var prompt by remember(documentName, initialPrompt) { mutableStateOf(initialPrompt.orEmpty()) }
    val messages = remember(documentName) { mutableStateListOf<ChatMessage>() }

    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Outlined.Search, contentDescription = null, tint = DataCubeColors.Blue)
            Spacer(Modifier.width(8.dp))
            Column(Modifier.weight(1f)) {
                Text("Searching in", style = MaterialTheme.typography.labelMedium, color = DataCubeColors.TextSecondary)
                Text(documentName, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.SemiBold, color = DataCubeColors.Navy)
            }
            AssistChip(onClick = {}, label = { Text("On device") })
        }
        if (textPreview.isNullOrBlank()) {
            Box(Modifier.weight(1f).fillMaxWidth().padding(12.dp), contentAlignment = Alignment.Center) {
                SourceUnavailableCard(previewLoading, previewError, extractionStatus, extractionProgress, extractionError)
            }
        } else if (messages.isEmpty()) {
            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                Column(Modifier.padding(28.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(9.dp)) {
                    Icon(Icons.Outlined.ChatBubbleOutline, contentDescription = null, tint = DataCubeColors.Blue, modifier = Modifier.size(42.dp))
                    Text("Ask about this document", fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
                    Text(
                        "Searches extracted text and returns matching passages with page references. This local search does not invent an AI answer.",
                        color = DataCubeColors.TextSecondary, style = MaterialTheme.typography.bodySmall
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
                            Surface(shape = RoundedCornerShape(18.dp, 18.dp, 4.dp, 18.dp), color = DataCubeColors.BlueLight) {
                                Text(message.question, Modifier.padding(13.dp), color = DataCubeColors.Navy)
                            }
                        }
                    } else {
                        ToolCard {
                            Text("Matches from your document", fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
                            Spacer(Modifier.height(8.dp))
                            if (message.matches.isEmpty()) {
                                Text("No matching passage was found. Try different wording or a more specific term.", color = DataCubeColors.TextSecondary)
                            } else {
                                message.matches.forEachIndexed { index, snippet ->
                                    SelectionContainer { Text(snippet.text, color = DataCubeColors.Navy, style = MaterialTheme.typography.bodyMedium) }
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Icon(Icons.Outlined.Description, contentDescription = null, tint = DataCubeColors.Blue, modifier = Modifier.size(15.dp))
                                        Spacer(Modifier.width(5.dp))
                                        Text(
                                            snippet.page?.let { "$documentName · Page $it" } ?: "$documentName · Local text",
                                            style = MaterialTheme.typography.labelSmall, color = DataCubeColors.TextSecondary
                                        )
                                    }
                                    if (index != message.matches.lastIndex) HorizontalDivider(Modifier.padding(vertical = 8.dp), color = DataCubeColors.Divider)
                                }
                            }
                        }
                    }
                }
            }
        }
        Surface(
            color = Color.White, shape = RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp),
            border = BorderStroke(1.dp, DataCubeColors.Divider), tonalElevation = 2.dp
        ) {
            Row(Modifier.fillMaxWidth().navigationBarsPadding().imePadding().padding(10.dp), verticalAlignment = Alignment.Bottom) {
                OutlinedTextField(
                    value = prompt, onValueChange = { prompt = it.take(500) }, Modifier.weight(1f),
                    placeholder = { Text("Ask AU about this document…") }, shape = RoundedCornerShape(18.dp), maxLines = 4
                )
                Spacer(Modifier.width(8.dp))
                FilledIconButton(
                    onClick = {
                        val cleanPrompt = prompt.trim()
                        if (cleanPrompt.isNotEmpty() && !textPreview.isNullOrBlank()) {
                            messages.add(ChatMessage(cleanPrompt, emptyList(), true))
                            messages.add(ChatMessage(cleanPrompt, findRelevantSnippets(cleanPrompt, textPreview), false))
                            prompt = ""
                        }
                    },
                    enabled = prompt.isNotBlank() && !textPreview.isNullOrBlank(), Modifier.size(52.dp)
                ) { Icon(Icons.Outlined.Send, contentDescription = "Search document") }
            }
        }
    }
}

@Composable
fun SmartNoteWorkspace(documentName: String, textPreview: String?, previewLoading: Boolean) {
    var selectedView by remember(documentName) { mutableIntStateOf(1) }
    val topics = remember(textPreview) { documentTopics(textPreview) }
    val summary = remember(textPreview) { documentSummary(textPreview) }
    val snippets = remember(textPreview) { sourceSnippets(textPreview) }

    ToolPage("Smart Note", "Organize key ideas extracted from $documentName. Content stays on this device.") {
        if (textPreview.isNullOrBlank()) SourceUnavailableCard(previewLoading, null) else {
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                SegmentedButton(selectedView == 0, { selectedView = 0 }, SegmentedButtonDefaults.itemShape(0, 2)) {
                    Icon(Icons.Outlined.AccountTree, contentDescription = null); Spacer(Modifier.width(6.dp)); Text("Diagram")
                }
                SegmentedButton(selectedView == 1, { selectedView = 1 }, SegmentedButtonDefaults.itemShape(1, 2)) {
                    Icon(Icons.Outlined.Notes, contentDescription = null); Spacer(Modifier.width(6.dp)); Text("Notes")
                }
            }
            if (selectedView == 1) {
                ToolCard {
                    Text("Study notes", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
                    Text("Extracted from $documentName", style = MaterialTheme.typography.bodySmall, color = DataCubeColors.TextSecondary)
                    Spacer(Modifier.height(12.dp))
                    Text("Key takeaway", fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
                    Text(summary.ifBlank { "No readable passages were extracted." }, color = DataCubeColors.Navy)
                }
                topics.forEachIndexed { index, topic ->
                    ToolCard {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Surface(shape = RoundedCornerShape(50), color = DataCubeColors.BlueLight) {
                                Text((index + 1).toString(), Modifier.padding(horizontal = 11.dp, vertical = 6.dp), color = DataCubeColors.BlueDark, fontWeight = FontWeight.Bold)
                            }
                            Spacer(Modifier.width(9.dp)); Text(topic, fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
                        }
                        snippets.firstOrNull { it.text.contains(topic, ignoreCase = true) }?.let { evidence ->
                            Spacer(Modifier.height(8.dp)); Text(evidence.text, color = DataCubeColors.TextSecondary)
                        }
                    }
                }
                ToolCard {
                    Text("Source", fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
                    Text("These are extractive study aids built from available text, not an AI paraphrase.", style = MaterialTheme.typography.bodySmall, color = DataCubeColors.TextSecondary)
                }
            } else {
                ToolCard {
                    Text("Concept map", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
                    Text("Main themes found in the extracted text", color = DataCubeColors.TextSecondary, style = MaterialTheme.typography.bodySmall)
                    Spacer(Modifier.height(16.dp))
                    Surface(shape = RoundedCornerShape(16.dp), color = DataCubeColors.BlueLight, border = BorderStroke(1.dp, DataCubeColors.Divider)) {
                        Text(documentName, Modifier.fillMaxWidth().padding(14.dp), color = DataCubeColors.Navy, fontWeight = FontWeight.Bold)
                    }
                    if (topics.isEmpty()) Text("No distinct headings or repeated terms were detected.", Modifier.padding(10.dp), color = DataCubeColors.TextSecondary)
                    else topics.forEach { topic ->
                        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Text("│", color = DataCubeColors.Blue)
                                Surface(shape = RoundedCornerShape(14.dp), color = Color.White, border = BorderStroke(1.dp, DataCubeColors.Divider)) {
                                    Text(topic, Modifier.padding(horizontal = 16.dp, vertical = 11.dp), color = DataCubeColors.Navy, fontWeight = FontWeight.SemiBold)
                                }
                            }
                        }
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
                    Icon(Icons.Outlined.Description, contentDescription = null, tint = DataCubeColors.Blue)
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text(documentName, fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
                        Text(sourceSnippets(textPreview).size.toString() + " readable passages found", style = MaterialTheme.typography.bodySmall, color = DataCubeColors.TextSecondary)
                    }
                    Icon(Icons.Outlined.CheckCircle, contentDescription = "Document ready", tint = Color(0xFF168A58))
                }
                Spacer(Modifier.height(14.dp))
                Button(onClick = { generated = true }, Modifier.fillMaxWidth().heightIn(min = 50.dp)) {
                    Icon(Icons.Outlined.AutoAwesome, contentDescription = null); Spacer(Modifier.width(8.dp))
                    Text(if (generated) "Refresh Study Plan" else "Generate Study Plan")
                }
            }
            if (generated) {
                ToolCard {
                    Text("Key topics to focus on", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
                    Text("Topics are identified from headings and repeated terms; they are not exam-probability scores.", style = MaterialTheme.typography.bodySmall, color = DataCubeColors.TextSecondary)
                    Spacer(Modifier.height(12.dp))
                    topics.forEachIndexed { index, topic ->
                        Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text((index + 1).toString() + ".", color = DataCubeColors.Blue, fontWeight = FontWeight.Bold)
                            Spacer(Modifier.width(8.dp)); Text(topic, Modifier.weight(1f), color = DataCubeColors.Navy, fontWeight = FontWeight.SemiBold)
                            AssistChip(onClick = {}, label = { Text("Review") })
                        }
                    }
                    if (topics.isEmpty()) Text("No distinct topics could be identified from this text.", color = DataCubeColors.TextSecondary)
                }
                ToolCard {
                    Text("Suggested revision questions", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
                    questions.take(5).forEachIndexed { index, question ->
                        Column(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
                            Text((index + 1).toString() + ". " + question.prompt, color = DataCubeColors.Navy, fontWeight = FontWeight.Medium)
                            Text(question.page?.let { "Source: page $it" } ?: "Source: extracted document text", color = DataCubeColors.TextSecondary, style = MaterialTheme.typography.labelSmall)
                        }
                        if (index != questions.take(5).lastIndex) HorizontalDivider(color = DataCubeColors.Divider)
                    }
                }
            } else {
                ToolCard {
                    Text("What this plan uses", fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
                    Text("The plan is derived from detected headings, recurring terms and readable passages. It does not claim to predict an actual exam.", color = DataCubeColors.TextSecondary)
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
        else if (!started) {
            ToolCard {
                Text("Practice setup", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
                Spacer(Modifier.height(14.dp))
                Text("Question count", fontWeight = FontWeight.SemiBold, color = DataCubeColors.Navy)
                ChoiceDropdown("$questionCount questions", listOf("5 questions", "10 questions", "15 questions")) {
                    questionCount = it.substringBefore(' ').toIntOrNull() ?: 5
                }
                Spacer(Modifier.height(10.dp))
                Text("Question style", fontWeight = FontWeight.SemiBold, color = DataCubeColors.Navy)
                ChoiceDropdown(questionStyle, listOf("Explain", "Recall")) { questionStyle = it }
                Spacer(Modifier.height(10.dp))
                Text("Focus area", fontWeight = FontWeight.SemiBold, color = DataCubeColors.Navy)
                ChoiceDropdown(focus, listOf("All topics") + topics) { focus = it }
                Spacer(Modifier.height(16.dp))
                Button(onClick = { started = true; completed = false; currentIndex = 0; answers = emptyMap(); showReference = false }, Modifier.fillMaxWidth().heightIn(min = 52.dp)) {
                    Icon(Icons.Outlined.PlayArrow, contentDescription = null); Spacer(Modifier.width(8.dp)); Text("Start Practice")
                }
            }
            Text("Questions are built from locally extracted text. Reference passages support self-checking; responses are not automatically graded.", color = DataCubeColors.TextSecondary, style = MaterialTheme.typography.bodySmall)
        } else if (completed) {
            ToolCard {
                Icon(Icons.Outlined.CheckCircle, contentDescription = null, tint = Color(0xFF168A58), modifier = Modifier.size(40.dp))
                Text("Practice complete", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
                Text(answers.values.count { it.isNotBlank() }.toString() + " of " + questions.size + " questions answered.", color = DataCubeColors.TextSecondary)
                Spacer(Modifier.height(12.dp))
                Text("Your answers remain available in this review until you restart the session.", style = MaterialTheme.typography.bodySmall, color = DataCubeColors.TextSecondary)
                Button(onClick = { completed = false; started = false; currentIndex = 0 }, Modifier.fillMaxWidth()) { Text("Practice Again") }
            }
            questions.forEachIndexed { index, question ->
                ToolCard {
                    Text("Question " + (index + 1), fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
                    Text(question.prompt, color = DataCubeColors.Navy)
                    Text(answers[index].orEmpty().ifBlank { "No answer entered." }, color = DataCubeColors.TextSecondary)
                }
            }
        } else {
            val question = questions.getOrNull(currentIndex)
            ToolCard {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Question " + (currentIndex + 1) + " of " + questions.size, fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
                    Spacer(Modifier.weight(1f)); Text(question?.topic.orEmpty(), color = DataCubeColors.Blue, style = MaterialTheme.typography.labelMedium)
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
                    style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = DataCubeColors.Navy
                )
                Spacer(Modifier.height(14.dp))
                OutlinedTextField(value = answer, onValueChange = { updated -> answers = answers + (currentIndex to updated) }, modifier = Modifier.fillMaxWidth(), minLines = 3, label = { Text("Your answer") }, placeholder = { Text("Write your response here…") })
                Spacer(Modifier.height(10.dp))
                OutlinedButton(onClick = { showReference = !showReference }, Modifier.fillMaxWidth(), enabled = question != null) {
                    Icon(Icons.Outlined.MenuBook, contentDescription = null); Spacer(Modifier.width(7.dp))
                    Text(if (showReference) "Hide source passage" else "Show source passage")
                }
                if (showReference && question != null) {
                    HorizontalDivider(Modifier.padding(vertical = 10.dp), color = DataCubeColors.Divider)
                    Text("Reference from your document", fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
                    Text(question.reference, color = DataCubeColors.TextSecondary)
                    Text(question.page?.let { "Page $it" } ?: "Local extracted text", style = MaterialTheme.typography.labelSmall, color = DataCubeColors.Blue)
                }
                Spacer(Modifier.height(14.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                    OutlinedButton(
                        onClick = { currentIndex = (currentIndex - 1).coerceAtLeast(0); showReference = false },
                        enabled = currentIndex > 0, Modifier.weight(1f)
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
            Text(value, Modifier.weight(1f), color = DataCubeColors.Navy)
            Icon(Icons.Outlined.ArrowDropDown, contentDescription = "Choose $value")
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            options.forEach { option -> DropdownMenuItem(text = { Text(option) }, onClick = { onSelect(option); expanded = false }) }
        }
    }
}

@Composable
fun PodcastWorkspace(documentName: String, textPreview: String?, previewLoading: Boolean) {
    val context = LocalContext.current
    var speechReady by remember { mutableStateOf(false) }
    var speaking by remember { mutableStateOf(false) }
    var speechError by remember { mutableStateOf<String?>(null) }
    var activeChapter by remember(documentName) { mutableIntStateOf(0) }
    var speechRate by remember(documentName) { mutableFloatStateOf(1.0f) }
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
            if (status != TextToSpeech.SUCCESS) speechError = "The Android speech engine could not be initialized."
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
        onDispose { tts.stop(); tts.shutdown() }
    }

    LaunchedEffect(tts, speechReady) {
        if (speechReady) {
            val languageResult = tts.setLanguage(Locale.getDefault())
            if (languageResult == TextToSpeech.LANG_MISSING_DATA || languageResult == TextToSpeech.LANG_NOT_SUPPORTED) {
                speechError = "The installed speech engine does not support your device language."
                speechReady = false
            }
        }
    }

    fun speak(text: String) {
        if (!speechReady || text.isBlank()) return
        tts.stop()
        tts.setSpeechRate(speechRate)
        speechError = null
        val result = tts.speak(text.take(4_000), TextToSpeech.QUEUE_FLUSH, null, "datacube-document-audio")
        if (result == TextToSpeech.ERROR) {
            speaking = false
            speechError = "Narration could not be started."
        } else speaking = true
    }

    ToolPage("Podcast", "Listen to a spoken summary of $documentName using your Android speech engine.") {
        if (textPreview.isNullOrBlank()) SourceUnavailableCard(previewLoading, null)
        else {
            ToolCard {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Surface(shape = RoundedCornerShape(18.dp), color = DataCubeColors.Navy) {
                        Icon(Icons.Outlined.GraphicEq, contentDescription = "Audio summary", tint = Color.White, modifier = Modifier.size(78.dp).padding(20.dp))
                    }
                    Spacer(Modifier.width(14.dp))
                    Column(Modifier.weight(1f)) {
                        Text("$documentName · Audio Summary", fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
                        Text(chapters.size.toString() + " chapters · Text-to-speech", color = DataCubeColors.TextSecondary, style = MaterialTheme.typography.bodySmall)
                        Text(if (speaking) "Narration playing" else "Ready to play", color = DataCubeColors.Blue, style = MaterialTheme.typography.labelMedium)
                    }
                }
                Spacer(Modifier.height(16.dp))
                Text("Narration speed", fontWeight = FontWeight.SemiBold, color = DataCubeColors.Navy)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf(0.8f, 1.0f, 1.2f).forEach { rate ->
                        FilterChip(selected = speechRate == rate, onClick = { speechRate = rate; if (speaking) speak(summary) }, label = { Text(rate.toString() + "x") })
                    }
                }
                Spacer(Modifier.height(14.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Button(
                        onClick = {
                            if (speaking) { tts.stop(); speaking = false }
                            else speak(chapters.getOrNull(activeChapter)?.first?.text ?: summary)
                        },
                        enabled = speechReady && summary.isNotBlank(),
                        Modifier.weight(1f).heightIn(min = 50.dp)
                    ) {
                        Icon(if (speaking) Icons.Outlined.Stop else Icons.Outlined.PlayArrow, contentDescription = null)
                        Spacer(Modifier.width(7.dp)); Text(if (speaking) "Stop narration" else "Play summary")
                    }
                    OutlinedButton(onClick = { activeChapter = 0; speak(summary) }, enabled = speechReady && summary.isNotBlank()) { Text("Full summary") }
                }
                speechError?.let { Spacer(Modifier.height(8.dp)); Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
                if (!speechReady && speechError == null) {
                    Spacer(Modifier.height(8.dp)); Text("Preparing the installed Android speech engine…", color = DataCubeColors.TextSecondary, style = MaterialTheme.typography.bodySmall)
                }
                Text(
                    "Speech is played through the installed Android text-to-speech engine. No audio file is created or uploaded by this screen.",
                    Modifier.padding(top = 10.dp), style = MaterialTheme.typography.bodySmall, color = DataCubeColors.TextSecondary
                )
            }
            ToolCard {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Chapters", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
                    Spacer(Modifier.weight(1f)); Text(chapters.size.toString() + " sections", color = DataCubeColors.TextSecondary, style = MaterialTheme.typography.bodySmall)
                }
                chapters.forEachIndexed { index, chapter ->
                    Surface(
                        onClick = { activeChapter = index; speak(chapter.first.text) },
                        shape = RoundedCornerShape(14.dp),
                        color = if (activeChapter == index) DataCubeColors.BlueLight else Color.White,
                        border = BorderStroke(1.dp, DataCubeColors.Divider), enabled = speechReady
                    ) {
                        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 13.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(if (activeChapter == index && speaking) Icons.Outlined.VolumeUp else Icons.Outlined.PlayArrow, contentDescription = "Play " + chapter.second, tint = DataCubeColors.Blue)
                            Spacer(Modifier.width(10.dp))
                            Column(Modifier.weight(1f)) {
                                Text(chapter.second, color = DataCubeColors.Navy, fontWeight = FontWeight.SemiBold)
                                Text(chapter.first.page?.let { "Starts near page $it" } ?: "Extracted document passage", color = DataCubeColors.TextSecondary, style = MaterialTheme.typography.labelSmall)
                            }
                        }
                    }
                    if (index != chapters.lastIndex) Spacer(Modifier.height(8.dp))
                }
            }
            ToolCard {
                Text("Audio summary text", fontWeight = FontWeight.Bold, color = DataCubeColors.Navy)
                Spacer(Modifier.height(7.dp)); Text(summary, color = DataCubeColors.TextSecondary)
            }
        }
    }
}
