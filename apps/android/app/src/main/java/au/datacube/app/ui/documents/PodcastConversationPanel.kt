package au.datacube.app.ui.documents

import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.LocalContext
import au.datacube.app.audio.NeuralNarration
import au.datacube.app.audio.SmoothOfflineNarration
import au.datacube.app.audio.PodcastOverviewSession
import au.datacube.app.audio.PodcastSpeaker
import au.datacube.app.data.rag.LocalGenerativeEngine
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Two-speaker Audio Overview. Script generation belongs to the document,
 * not the composable screen; it can complete after navigating away.
 */
@Composable
fun PodcastConversationPanel(
    documentId: String,
    documentName: String,
    textPreview: String?,
    playbackSpeed: Float
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val session = remember(documentId) { PodcastOverviewSession.get(documentId, context) }
    val turns = session.turns
    val modelReady = LocalGenerativeEngine.installed(context)
    val neuralReady = NeuralNarration.installed(context)
    var listening by remember(documentId) { mutableStateOf(false) }
    var activeSpeakerIndex by remember(documentId) { mutableIntStateOf(-1) }
    var playbackStage by remember(documentId) { mutableStateOf("") }
    var playbackError by remember(documentId) { mutableStateOf<String?>(null) }
    var playbackJob by remember(documentId) { mutableStateOf<Job?>(null) }
    var showTranscript by remember(documentId) { mutableStateOf(false) }
    var smoothVoice by remember(documentId) { mutableStateOf(true) }

    DisposableEffect(documentId) {
        onDispose {
            playbackJob?.cancel()
            if (listening) {
                NeuralNarration.stop()
                SmoothOfflineNarration.stop()
            }
        }
    }

    fun startPlayback() {
        if (turns.isEmpty() || (!smoothVoice && !neuralReady) || listening || session.generating) return
        playbackError = null
        listening = true
        playbackStage = "Preparing the voices"
        playbackJob = scope.launch {
            try {
                // Avoid keeping the large chat model resident while Kokoro
                // allocates its neural speech engine on lower-RAM phones.
                if (!smoothVoice) LocalGenerativeEngine.release()
                val onSpeaker: suspend (Int) -> Unit = { index ->
                    withContext(Dispatchers.Main) { activeSpeakerIndex = index }
                }
                val onStage: suspend (String) -> Unit = { stage ->
                    withContext(Dispatchers.Main) { playbackStage = stage }
                }
                if (smoothVoice) {
                    SmoothOfflineNarration.speakDialogue(
                        context, turns.toList(), playbackSpeed, onSpeaker, onStage
                    )
                } else {
                    NeuralNarration.speakDialogue(
                        context, turns.toList(), playbackSpeed, onSpeaker, onStage
                    )
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Exception) {
                playbackError = "Audio conversation stopped: " +
                    (failure.message ?: "Offline voice is unavailable on this device.")
            } finally {
                listening = false
                activeSpeakerIndex = -1
                playbackStage = ""
                playbackJob = null
            }
        }
    }

    Surface(
        shape = RoundedCornerShape(26.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        tonalElevation = 3.dp
    ) {
        Column(Modifier.fillMaxWidth().padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.Podcasts, contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(30.dp))
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text("Audio conversation",
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onSurface,
                        style = MaterialTheme.typography.titleLarge)
                    Text("A grounded study discussion, read aloud",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodySmall)
                }
            }
            Text(documentName, style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2)
            Row(
                horizontalArrangement = Arrangement.spacedBy(9.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                FilterChip(
                    selected = smoothVoice,
                    onClick = {
                        if (!listening) smoothVoice = true
                    },
                    label = { Text("Smooth offline") }
                )
                FilterChip(
                    selected = !smoothVoice,
                    enabled = neuralReady && !listening,
                    onClick = { smoothVoice = false },
                    label = { Text("Kokoro neural") }
                )
            }
            AuPodcastStage(
                playing = listening,
                activeSpeaker = turns.getOrNull(activeSpeakerIndex)?.speaker,
                status = if (listening) playbackStage else "",
                hasScript = turns.isNotEmpty(),
                enabled = (smoothVoice || neuralReady) && !session.generating,
                onPlayPause = {
                    if (listening) {
                        playbackJob?.cancel()
                        NeuralNarration.stop()
                        SmoothOfflineNarration.stop()
                        listening = false
                    } else startPlayback()
                }
            )
            if (session.generating) {
                LinearProgressIndicator(Modifier.fillMaxWidth())
                Text(session.stage.ifBlank { "AU is preparing your podcast" },
                    color = MaterialTheme.colorScheme.primary,
                    style = MaterialTheme.typography.bodyMedium)
                Text("You can visit another workspace. Preparation continues while the app stays open.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall)
                TextButton(onClick = session::stop) { Text("Cancel preparation") }
            } else if (turns.isEmpty()) {
                Text(
                    "AU first studies selected passages, then prepares a dialogue. Nothing is downloaded automatically.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodyMedium
                )
                Button(
                    enabled = modelReady && !textPreview.isNullOrBlank(),
                    onClick = {
                        session.generate(
                            context = context,
                            documentName = documentName,
                            extractedText = textPreview.orEmpty()
                        )
                    },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Icon(Icons.Outlined.AutoAwesome, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text("Create audio conversation")
                }
                if (!modelReady) {
                    Text("Choose and install a chat model in Models to write the conversation.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodySmall)
                }
            } else {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        if (listening) "Speaking ${activeSpeakerIndex + 1} of ${turns.size}"
                        else "${turns.size} conversational turns prepared",
                        modifier = Modifier.weight(1f),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodySmall
                    )
                    if (listening) CircularProgressIndicator(
                        Modifier.size(18.dp), strokeWidth = 2.dp)
                }
                OutlinedButton(
                    onClick = {
                        if (!listening) session.generate(context, documentName, textPreview.orEmpty())
                    },
                    enabled = !listening && modelReady && !textPreview.isNullOrBlank()
                ) {
                    Icon(Icons.Outlined.Refresh, contentDescription = null)
                    Spacer(Modifier.width(6.dp))
                    Text("Regenerate conversation")
                }
                if (!smoothVoice && !neuralReady) {
                    Text("Install Kokoro in Models, or select Smooth offline below.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodySmall)
                }
                HorizontalDivider()
                TextButton(onClick = { showTranscript = !showTranscript }) {
                    Text(if (showTranscript) "Hide transcript" else "View transcript")
                    Spacer(Modifier.width(6.dp))
                    Icon(if (showTranscript) Icons.Outlined.ExpandLess
                        else Icons.Outlined.ExpandMore, null)
                }
                if (showTranscript) {
                    Column(
                        Modifier.fillMaxWidth().heightIn(max = 420.dp)
                            .verticalScroll(rememberScrollState())
                            .animateContentSize(),
                        verticalArrangement = Arrangement.spacedBy(9.dp)
                    ) {
                        turns.forEachIndexed { index, turn ->
                            Surface(
                                color = if (index == activeSpeakerIndex && listening)
                                    MaterialTheme.colorScheme.primaryContainer
                                else MaterialTheme.colorScheme.surfaceVariant,
                                shape = RoundedCornerShape(16.dp),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Column(Modifier.padding(13.dp),
                                    verticalArrangement = Arrangement.spacedBy(5.dp)) {
                                    Text(
                                        if (turn.speaker == PodcastSpeaker.HOST) "Host"
                                        else "Guide",
                                        color = MaterialTheme.colorScheme.primary,
                                        fontWeight = FontWeight.Bold,
                                        style = MaterialTheme.typography.labelMedium
                                    )
                                    Text(turn.text,
                                        color = MaterialTheme.colorScheme.onSurface,
                                        style = MaterialTheme.typography.bodyMedium)
                                }
                            }
                        }
                    }
                }
            }
            session.error?.let {
                Text(it, color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall)
            }
            playbackError?.let {
                Text(it, color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall)
            }
            Text("Prepared from extracted document passages on this device. Review the transcript for accuracy.",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.labelSmall)
        }
    }
}

