package au.datacube.app.ui.common

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaMetadataRetriever
import android.media.MediaPlayer
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.selection.selectable
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.semantics.Role
import au.datacube.app.audio.SpeechWaveform
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import au.datacube.app.audio.AuAudioPlayback
import au.datacube.app.audio.NeuralNarration
import au.datacube.app.audio.OfflineNarrationPreferences
import au.datacube.app.audio.SmoothOfflineNarration
import java.io.File
import java.util.UUID
import kotlinx.coroutines.*

internal data class PreparedSpeechPart(val file: File, val durationMs: Long)

/** One selected private audio cache, shared with the existing playback coordinator.
 * A completed or paused response can replay without regenerating the voice.
 */
internal class AuReadAloudState(private val context: Context, private val scope: CoroutineScope) {
    var positionMs by mutableLongStateOf(0L)
        private set
    var durationMs by mutableLongStateOf(0L)
        private set
    var active by mutableStateOf<Int?>(null)
        private set
    var voiceLabel by mutableStateOf("")
        private set
    var stage by mutableStateOf("")
        private set
    var error by mutableStateOf<String?>(null)
        private set
    var waveform by mutableStateOf<List<Float>>(emptyList())
        private set
    var preparing by mutableStateOf(false)
        private set
    var playing by mutableStateOf(false)
        private set
    private var job: Job? = null
    private var revision = 0
    private var directory: File? = null
    private var parts = emptyList<PreparedSpeechPart>()
    private var cacheKey = ""
    var streaming by mutableStateOf(false)
        private set
    @Volatile private var streamPaused = false
    private var playbackSpeed = 1f
    private var directTurns = emptyList<au.datacube.app.audio.PodcastTurn>()
    var directIndex by mutableIntStateOf(0)
        private set
    val directCount: Int get() = directTurns.size
    val directMode: Boolean get() = directTurns.isNotEmpty()
    val canToggle: Boolean get() = streaming || (!preparing && (directMode || parts.isNotEmpty()))

    val neuralAvailable: Boolean get() = NeuralNarration.installed(context)

    fun stop() {
        revision++
        val oldJob = job
        val oldDirectory = directory
        oldJob?.cancel()
        job = null
        directory = null
        parts = emptyList()
        directTurns = emptyList()
        directIndex = 0
        waveform = emptyList()
        cacheKey = ""
        active = null
        stage = ""
        error = null
        preparing = false
        playing = false
        streaming = false
        streamPaused = false
        positionMs = 0
        durationMs = 0
        if (oldDirectory != null) scope.launch(Dispatchers.IO) {
            oldJob?.join()
            oldDirectory.deleteRecursively()
        }
    }

    fun playAndroid(id: Int, answer: String) = play(id, answer, true, OfflineNarrationPreferences(context).neuralVoice)
    fun playKokoro(id: Int, answer: String) = play(id, answer, false, OfflineNarrationPreferences(context).neuralVoice)

    fun playPreferred(id: Int, answer: String) {
        val preference = OfflineNarrationPreferences(context)
        val system = preference.readAloudEngine == "android" ||
            (preference.readAloudEngine == "auto" && !neuralAvailable)
        play(id, answer, system, preference.neuralVoice)
    }

    private fun play(id: Int, answer: String, system: Boolean, neuralVoice: String) {
        val plain = AuSpokenResponse.format(answer)
        if (plain.isBlank()) return
        val preference = OfflineNarrationPreferences(context)
        val key = "${if (system) "android" else neuralVoice}:${preference.speed}:${preference.pitch}:${preference.voiceName}:$plain"
        if (active == id && cacheKey == key && (preparing || streaming || parts.isNotEmpty() || directMode)) {
            if (!preparing) toggle()
            return
        }
        AuReadAloudSessions.activate(this)
        stop()
        active = id
        cacheKey = key
        playbackSpeed = preference.speed
        voiceLabel = if (system) "Offline Android voice" else NeuralNarration.presetVoices[neuralVoice] ?: "Kokoro"
        if (!system && !neuralAvailable) {
            error = "Install Kokoro in Models or choose Android voice in Settings."
            stage = "Voice unavailable"
            return
        }
        if (plain.length > 128_000) {
            error = "This response is too long for one audio session. Open a shorter section."
            stage = "Voice unavailable"
            return
        }
        if (system) {
            directTurns = au.datacube.app.audio.NeuralTextSegmenter.split(plain, maxChunk = 1000, maxText = 12_000)
                .map { au.datacube.app.audio.PodcastTurn(au.datacube.app.audio.PodcastSpeaker.GUIDE, it) }
            startDirect()
            return
        }
        val target = File(context.cacheDir, "au-read-aloud/" + UUID.randomUUID().toString())
        directory = target
        preparing = true
        stage = "Preparing audio"
        val token = ++revision
        job = AuAudioPlayback.launch(context, "Preparing or playing response audio", onFinished = {
            finish(token)
        }) {
            try {
                withContext(Dispatchers.IO) {
                    target.parentFile?.listFiles()?.filter {
                        it != target && System.currentTimeMillis() - it.lastModified() > 24L * 60 * 60 * 1000
                    }?.forEach { it.deleteRecursively() }
                    check(target.mkdirs()) { "Could not create audio cache." }
                }
                val report: suspend (String) -> Unit = { value ->
                    withContext(Dispatchers.Main) { if (token == revision) stage = value }
                }
                report("Preparing selected neural voice")
                val output = File(target, "response.wav")
                NeuralNarration.playAndCacheReadAloud(context, plain, neuralVoice, playbackSpeed, output, report,
                    onProgress = { position, duration -> withContext(Dispatchers.Main.immediate) {
                        if (token == revision) { positionMs = position; durationMs = duration }
                    } },
                    onStarted = { withContext(Dispatchers.Main.immediate) {
                        if (token == revision) { streaming = true; preparing = false; playing = !streamPaused }
                    } },
                    isPaused = { streamPaused })
                val files = listOf(output)
                val ready = withContext(Dispatchers.IO) {
                    check(files.isNotEmpty() && files.sumOf { it.length() } <= 128L * 1024 * 1024)
                    files.map { file ->
                        val retriever = MediaMetadataRetriever()
                        try {
                            retriever.setDataSource(file.absolutePath)
                            val duration = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
                            check(duration > 0L) { "Audio duration is unavailable." }
                            PreparedSpeechPart(file, duration)
                        } finally { retriever.release() }
                    }
                }
                if (token != revision) return@launch
                val levels = withContext(Dispatchers.IO) {
                    SpeechWaveform.sample(ready.map { it.file to it.durationMs })
                }
                if (token != revision) return@launch
                parts = ready
                waveform = levels
                durationMs = ready.sumOf { it.durationMs }
                preparing = false
                if (!system) runCatching { au.datacube.app.notifications.LocalNotificationService(context)
                    .showAiReady("voice-" + target.name, "Kokoro audio is ready") }
                positionMs = durationMs
                streaming = false
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                if (token == revision) error = "Could not prepare or play this voice. Check Voice in Settings."
            }
        }
    }

    private fun startDirect() {
        if (directTurns.isEmpty()) return
        AuReadAloudSessions.activate(this)
        if (directIndex >= directTurns.size) directIndex = 0
        val start = directIndex
        val token = ++revision
        error = null
        playing = true
        stage = "Playing"
        job = AuAudioPlayback.launch(context, "Reading response aloud", onFinished = {
            if (token == revision) {
                playing = false
                stage = if (error != null) "Audio unavailable" else if (directIndex >= directTurns.size) "Completed" else "Paused"
            }
        }) {
            try {
                SmoothOfflineNarration.speakDialogue(context, directTurns.drop(start),
                    OfflineNarrationPreferences(context).speed,
                    onSpeaker = { index -> if (token == revision) directIndex = start + index },
                    onStage = {})
                if (token == revision) directIndex = directTurns.size
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { if (token == revision) error = "Android offline voice unavailable. Check Voice settings." }
        }
    }

    private fun finish(token: Int) {
        if (token != revision) return
        playing = false
        preparing = false
        streaming = false
        streamPaused = false
        stage = if (error != null) "Audio unavailable" else if (parts.isEmpty()) "Preparation interrupted"
            else if (positionMs >= durationMs) "Completed" else "Paused"
        if (parts.isEmpty()) {
            val old = directory
            directory = null
            if (old != null) scope.launch(Dispatchers.IO) { old.deleteRecursively() }
        }
    }

    private suspend fun playCached(token: Int) {
        var start = 0L
        for (part in parts) {
            currentCoroutineContext().ensureActive()
            val end = start + part.durationMs
            if (positionMs >= end) { start = end; continue }
            val base = start
            val offset = (positionMs - base).coerceIn(0L, part.durationMs - 1)
            val player = MediaPlayer()
            try {
                val ready = CompletableDeferred<Unit>()
                val complete = CompletableDeferred<Unit>()
                player.setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                player.setOnPreparedListener { ready.complete(Unit) }
                player.setOnCompletionListener { complete.complete(Unit) }
                player.setOnErrorListener { _, _, _ ->
                    val failure = IllegalStateException("Audio playback failed")
                    ready.completeExceptionally(failure)
                    complete.completeExceptionally(failure)
                    true
                }
                player.setDataSource(part.file.absolutePath)
                player.prepareAsync()
                withTimeout(10_000) { ready.await() }
                if (offset > 0) {
                    val seek = CompletableDeferred<Unit>()
                    player.setOnSeekCompleteListener { seek.complete(Unit) }
                    player.seekTo(offset, MediaPlayer.SEEK_CLOSEST)
                    withTimeout(5_000) { seek.await() }
                }
                currentCoroutineContext().ensureActive()
                if (token != revision) return
                if (playbackSpeed != 1f) runCatching {
                    player.playbackParams = android.media.PlaybackParams().setSpeed(playbackSpeed).setPitch(1f)
                }
                player.start()
                playing = true
                stage = "Playing"
                while (!complete.isCompleted) {
                    delay(150)
                    if (token != revision) return
                    positionMs = (base + player.currentPosition.toLong()).coerceIn(base, end)
                }
                complete.await()
                positionMs = end
                start = end
            } finally { player.release() }
        }
        positionMs = durationMs
    }

    fun toggle() {
        if (streaming) {
            streamPaused = !streamPaused
            playing = !streamPaused
            stage = if (streamPaused) "Paused" else "Playing"
            return
        }
        if (directMode) {
            if (playing || job?.isActive == true) {
                revision++
                job?.cancel()
                playing = false
                stage = "Paused"
            } else startDirect()
            return
        }
        if (preparing || parts.isEmpty()) return
        if (playing || job?.isActive == true) {
            revision++
            job?.cancel()
            playing = false
            stage = "Paused"
        } else {
            if (positionMs >= durationMs) positionMs = 0
            resumeCached()
        }
    }

    private fun resumeCached() {
        if (parts.isEmpty()) return
        AuReadAloudSessions.activate(this)
        val token = ++revision
        error = null
        stage = "Opening audio"
        job = AuAudioPlayback.launch(context, "Playing response audio", onFinished = { finish(token) }) {
            try { playCached(token) }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { if (token == revision) error = "Could not replay saved audio." }
        }
    }

    fun seekTo(targetMs: Long) {
        if (streaming || preparing || parts.isEmpty()) return
        val resume = playing || job?.isActive == true
        revision++
        job?.cancel()
        playing = false
        positionMs = targetMs.coerceIn(0L, durationMs)
        stage = if (positionMs == durationMs) "Completed" else "Paused"
        if (resume && positionMs < durationMs) resumeCached()
    }
}

internal object AuReadAloudSessions {
    private val sessions = linkedMapOf<String, AuReadAloudState>()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    fun get(key: String, context: Context): AuReadAloudState =
        sessions.getOrPut(key) { AuReadAloudState(context.applicationContext, scope) }
    fun activate(current: AuReadAloudState) {
        sessions.values.filter { it !== current && it.active != null }.forEach { it.stop() }
    }
    fun forget(key: String) { sessions.remove(key)?.stop() }
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
    var choosing by remember(id, answer) { mutableStateOf(false) }
    var selected by remember(id, answer) { mutableStateOf("kokoro") }
    IconButton(onClick = {
        if (speech.active == id && speech.playing) speech.toggle()
        else if (speech.neuralAvailable) { selected = "kokoro"; choosing = true }
        else speech.playAndroid(id, answer)
    }) {
        Icon(if (speech.active == id && speech.playing) Icons.Outlined.Pause else Icons.Outlined.VolumeUp,
            contentDescription = if (speech.active == id && speech.playing) "Pause read aloud" else "Read aloud",
            modifier = Modifier.size(20.dp))
    }
    if (choosing) {
        DataCubeDialog(onDismissRequest = { choosing = false }, title = { Text("Read aloud") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    listOf(Triple("kokoro", "Kokoro", "Natural local AI voice · prepares audio first"),
                        Triple("android", "Android", "Speak immediately using installed voice")).forEach { (engine, label, description) ->
                        Surface(shape = androidx.compose.foundation.shape.RoundedCornerShape(16.dp),
                            color = if (selected == engine) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant,
                            contentColor = if (selected == engine) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant) {
                            Row(Modifier.fillMaxWidth().selectable(selected = selected == engine, role = Role.RadioButton,
                                onClick = { selected = engine }).padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                                RadioButton(selected = selected == engine, onClick = null)
                                Spacer(Modifier.width(10.dp))
                                Column(Modifier.weight(1f)) {
                                    Text(label, style = MaterialTheme.typography.titleMedium)
                                    Text(description, style = MaterialTheme.typography.bodySmall)
                                }
                            }
                        }
                    }
                }
            }, confirmButton = { TextButton(onClick = {
                choosing = false
                if (selected == "kokoro" && speech.neuralAvailable) speech.playKokoro(id, answer)
                else speech.playAndroid(id, answer)
            }) { Text("Play") } }, dismissButton = { TextButton(onClick = { choosing = false }) { Text("Cancel") } })
    }
}

private fun timeLabel(ms: Long): String {
    val seconds = ms / 1000
    return "${seconds / 60}:" + (seconds % 60).toString().padStart(2, '0')
}

@Composable
internal fun AuReadAloudBar(speech: AuReadAloudState) {
    AnimatedVisibility(visible = speech.active != null) {
        Surface(Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 2.dp),
            shape = androidx.compose.foundation.shape.RoundedCornerShape(16.dp),
            color = MaterialTheme.colorScheme.surfaceVariant) {
            Column {
                Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp),
                    verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = speech::toggle, enabled = speech.canToggle) {
                        Icon(if (speech.playing) Icons.Outlined.Pause else Icons.Outlined.PlayArrow,
                            if (speech.playing) "Pause playback" else "Play audio")
                    }
                    Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                        if (speech.directMode) {
                            LinearProgressIndicator(progress = {
                                speech.directIndex.toFloat() / speech.directCount.coerceAtLeast(1)
                            }, modifier = Modifier.fillMaxWidth())
                        } else if (speech.streaming) {
                            Text(speech.stage, style = MaterialTheme.typography.labelSmall)
                        } else if (speech.preparing) {
                            LinearProgressIndicator(Modifier.fillMaxWidth())
                        } else if (speech.durationMs > 0) {
                            var scrub by remember(speech.active) { mutableStateOf<Float?>(null) }
                            val progress = (scrub ?: speech.positionMs.toFloat()) / speech.durationMs.toFloat()
                            val accent = MaterialTheme.colorScheme.primary
                            val unplayed = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .42f)
                            if (speech.waveform.isNotEmpty()) Canvas(Modifier.fillMaxWidth().height(20.dp).padding(horizontal = 8.dp)) {
                                val spacing = size.width / speech.waveform.size
                                speech.waveform.forEachIndexed { index, level ->
                                    val x = (index + .5f) * spacing
                                    val height = size.height * level.coerceIn(.10f, 1f)
                                    drawLine(if (index.toFloat() / speech.waveform.size < progress) accent else unplayed,
                                        Offset(x, center.y - height / 2), Offset(x, center.y + height / 2),
                                        strokeWidth = (spacing * .45f).coerceAtLeast(1f), cap = StrokeCap.Round)
                                }
                            }
                            Slider(value = scrub ?: speech.positionMs.toFloat(),
                                onValueChange = { scrub = it },
                                onValueChangeFinished = { scrub?.let { speech.seekTo(it.toLong()) }; scrub = null },
                                valueRange = 0f..speech.durationMs.toFloat(),
                                colors = if (speech.waveform.isEmpty()) SliderDefaults.colors() else SliderDefaults.colors(
                                    activeTrackColor = Color.Transparent, inactiveTrackColor = Color.Transparent))
                        }
                    }
                    if (speech.durationMs > 0) Text(timeLabel(speech.positionMs),
                        style = MaterialTheme.typography.labelSmall)
                    IconButton(onClick = speech::stop) { Icon(Icons.Outlined.Close, "Close audio player") }
                }
                speech.error?.let { Text(it, color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(8.dp)) }
            }
        }
    }
}

@Composable
internal fun AuVoiceSettings(onDismiss: () -> Unit) {
    val context = LocalContext.current
    val prefs = remember(context) { OfflineNarrationPreferences(context) }
    var engine by remember { mutableStateOf(prefs.readAloudEngine) }
    var voice by remember { mutableStateOf(prefs.neuralVoice) }
    val available = remember(context) { NeuralNarration.installed(context) }
    DataCubeDialog(onDismissRequest = onDismiss, title = { Text("Voice", style = MaterialTheme.typography.titleLarge) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("Read-aloud engine", style = MaterialTheme.typography.labelMedium)
                listOf("auto" to "Automatic · installed voice", "android" to "Android · quick offline voice",
                    "kokoro" to "Kokoro · local AI voice").forEach { (id, label) ->
                    val enabled = id != "kokoro" || available
                    Row(Modifier.fillMaxWidth().selectable(selected = engine == id, enabled = enabled, role = Role.RadioButton,
                        onClick = { engine = id; prefs.readAloudEngine = id }),
                        verticalAlignment = Alignment.CenterVertically) {
                        RadioButton(selected = engine == id, onClick = null, enabled = enabled, modifier = Modifier.padding(12.dp))
                        Text(label)
                    }
                }
                if (available) {
                    HorizontalDivider()
                    Text("Kokoro voice", style = MaterialTheme.typography.labelMedium)
                    NeuralNarration.presetVoices.forEach { (id, label) ->
                        Row(Modifier.fillMaxWidth().selectable(selected = voice == id, role = Role.RadioButton,
                            onClick = { voice = id; prefs.neuralVoice = id }), verticalAlignment = Alignment.CenterVertically) {
                            RadioButton(selected = voice == id, onClick = null, modifier = Modifier.padding(12.dp))
                            Text(label)
                        }
                    }
                } else Text("Download Kokoro in Models to unlock natural local voices.", style = MaterialTheme.typography.bodySmall)
            }
        }, confirmButton = { TextButton(onClick = onDismiss) { Text("Done") } })
}
