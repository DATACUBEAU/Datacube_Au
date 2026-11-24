package au.datacube.app.ui.common

import android.content.Context
import au.datacube.app.work.AuBackgroundWork
import au.datacube.app.audio.AuAudioPlayback
import android.content.Intent
import android.speech.tts.TextToSpeech
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.VolumeUp
import androidx.compose.material.icons.outlined.Stop
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import au.datacube.app.audio.NeuralNarration
import au.datacube.app.audio.NeuralTextSegmenter
import au.datacube.app.audio.PodcastSpeaker
import au.datacube.app.audio.PodcastTurn
import au.datacube.app.audio.SmoothOfflineNarration
import au.datacube.app.data.rag.LocalGenerativeEngine
import kotlinx.coroutines.*

internal class AuReadAloudState(private val context: Context, private val scope: CoroutineScope) {
    var active by mutableStateOf<Int?>(null)
        private set
    var stage by mutableStateOf("")
        private set
    var error by mutableStateOf<String?>(null)
        private set
    var errorId by mutableStateOf<Int?>(null)
        private set
    private var job: Job? = null
    private var revision = 0
    val neuralAvailable: Boolean get() = NeuralNarration.installed(context)

    // Discover user-installed speech services, including compatible KittenTTS engines.
    // Do not install anything, start a download or claim an engine is present by name alone.
    fun installedEngines(): List<Pair<String, String>> = context.packageManager
        .queryIntentServices(Intent(TextToSpeech.Engine.INTENT_ACTION_TTS_SERVICE), 0)
        .map { it.serviceInfo.packageName to it.loadLabel(context.packageManager).toString() }
        .distinctBy { it.first }.sortedBy { it.second }

    fun stop() {
        revision++
        if (job?.isActive == true) {
            job?.cancel()
            // The shared playback coordinator owns engine cleanup.
        }
        job = null
        active = null
        stage = ""
    }

    fun play(id: Int, answer: String, systemVoice: Boolean = false, enginePackage: String? = null) {
        stop()
        val token = revision
        val plain = AuSpokenResponse.format(answer)
        if (plain.isBlank()) return
        active = id
        error = null
        errorId = null
        stage = "Preparing audio"
        job = AuAudioPlayback.launch(context, "Preparing or playing response audio",
            onFinished = { if (token == revision) { active = null; stage = "" } }) {
            try {
                val report: suspend (String) -> Unit = { value ->
                    withContext(Dispatchers.Main) { if (token == revision) stage = value }
                }
                if (!systemVoice) {
                    check(neuralAvailable) { "Download Kokoro in Models to use neural speech." }
                    LocalGenerativeEngine.release()
                    NeuralNarration.speak(context, plain, NeuralNarration.DEFAULT_VOICE, 1f, report)
                } else {
                    val turns = NeuralTextSegmenter.split(plain, maxChunk = 350, maxText = 12_000)
                        .map { PodcastTurn(PodcastSpeaker.GUIDE, it) }
                    SmoothOfflineNarration.speakDialogue(context, turns, 1f, {}, report, enginePackage = enginePackage)
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Exception) {
                if (token == revision) {
                    errorId = id
                    error = failure.message ?: "Could not prepare audio."
                }
            } finally {
                if (token == revision) { active = null; stage = "" }
            }
        }
    }
}

internal object AuReadAloudSessions {
    private val sessions = linkedMapOf<String, AuReadAloudState>()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    fun get(key: String, context: Context): AuReadAloudState =
        sessions.getOrPut(key) { AuReadAloudState(context.applicationContext, scope) }
    fun stopAll() {
        sessions.values.forEach { it.stop() }
        sessions.clear()
    }
}

@Composable
internal fun rememberAuReadAloud(key: String): AuReadAloudState {
    val context = LocalContext.current.applicationContext
    return remember(context, key) { AuReadAloudSessions.get(key, context) }
}

@Composable
internal fun AuReadAloudAction(speech: AuReadAloudState, id: Int, answer: String) {
    var voiceMenu by remember(id) { mutableStateOf(false) }
    var installedEngines by remember(id) { mutableStateOf<List<Pair<String, String>>>(emptyList()) }
    Column {
        Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
            Box {
            TextButton(onClick = {
                if (speech.active == id) speech.stop() else {
                    installedEngines = speech.installedEngines()
                    voiceMenu = true
                }
            }) {
                Icon(if (speech.active == id) Icons.Outlined.Stop else Icons.Outlined.VolumeUp,
                    contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(5.dp))
                Text(if (speech.active == id) "Stop audio" else "Read aloud")
            }
            DropdownMenu(expanded = voiceMenu, onDismissRequest = { voiceMenu = false }) {
                DropdownMenuItem(
                    text = { Column { Text("Mobile voice"); Text("Quick offline playback", style = MaterialTheme.typography.bodySmall) } },
                    onClick = { voiceMenu = false; speech.play(id, answer, systemVoice = true) }
                )
                DropdownMenuItem(
                    enabled = speech.neuralAvailable,
                    text = { Column { Text("Kokoro"); Text(if (speech.neuralAvailable) "Natural voice · prepares audio first" else "Install in Models", style = MaterialTheme.typography.bodySmall) } },
                    onClick = { voiceMenu = false; speech.play(id, answer, systemVoice = false) }
                )
                if (installedEngines.isNotEmpty()) {
                    HorizontalDivider()
                    Text("Other installed speech engines", Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                        style = MaterialTheme.typography.labelSmall)
                    installedEngines.forEach { (packageName, label) ->
                        DropdownMenuItem(
                            text = { Text(label) },
                            onClick = { voiceMenu = false; speech.play(id, answer, systemVoice = true, enginePackage = packageName) }
                        )
                    }
                }
            }
            }
            if (speech.active == id) Text(speech.stage, style = MaterialTheme.typography.labelSmall,
                modifier = Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (speech.errorId == id) {
            Text(speech.error.orEmpty(), color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodySmall)
            TextButton(onClick = { speech.play(id, answer, systemVoice = true) }) {
                Text("Try offline system voice")
            }
        }
    }
}
