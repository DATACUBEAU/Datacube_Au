package au.datacube.app.ui.voice

import android.Manifest
import android.content.pm.PackageManager
import android.media.MediaPlayer
import au.datacube.app.audio.AuAudioPlayback
import kotlinx.coroutines.Job
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat

data class VoiceNoteConfig(
    val ownerId: String,
    val sessionId: String,
    val enabled: Boolean,
    val supportsAudio: Boolean,
    val onReady: (RecordedVoiceNote) -> Unit
)

/** Replaces the entire typing composer while recording or reviewing. */
@OptIn(androidx.compose.ui.ExperimentalComposeUiApi::class)
@Composable
internal fun VoiceNoteComposer(
    config: VoiceNoteConfig,
    normalContent: @Composable (@Composable () -> Unit) -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val focus = LocalFocusManager.current
    val keyboard = LocalSoftwareKeyboardController.current
    val currentConfig by rememberUpdatedState(config)
    val recorder = remember(context, config.ownerId, config.sessionId) {
        LocalVoiceNoteRecorder(context, config.ownerId)
    }
    var recording by remember(recorder) { mutableStateOf(false) }
    var paused by remember(recorder) { mutableStateOf(false) }
    var busy by remember(recorder) { mutableStateOf(false) }
    var millis by remember(recorder) { mutableIntStateOf(0) }
    var levels by remember(recorder) { mutableStateOf(emptyList<Float>()) }
    var preview by remember(recorder) { mutableStateOf<RecordedVoiceNote?>(null) }
    var error by remember(recorder) { mutableStateOf<String?>(null) }
    var previewVersion by remember(recorder) { mutableIntStateOf(0) }
    var previewJob by remember(recorder) { mutableStateOf<Job?>(null) }
    var player by remember(recorder) { mutableStateOf<MediaPlayer?>(null) }
    var playing by remember(recorder) { mutableStateOf(false) }
    var position by remember(recorder) { mutableIntStateOf(0) }
    val active = recording || paused || busy || preview != null

    fun stopPreview() {
        previewVersion++
        previewJob?.cancel()
        previewJob = null
        playing = false
        player = null
        position = 0
    }

    fun discard() {
        if (busy) return
        stopPreview()
        recorder.cancel()
        preview?.file?.delete()
        preview = null
        recording = false
        paused = false
        millis = 0
        levels = emptyList()
        error = null
    }

    fun start() {
        if (!currentConfig.enabled || active) return
        try {
            recorder.start(scope)
            focus.clearFocus(force = true)
            keyboard?.hide()
            error = null
            millis = 0
            levels = emptyList()
            paused = false
            recording = true
        } catch (_: Exception) {
            recorder.cancel()
            error = "The microphone could not start. Check microphone permission and device audio settings."
        }
    }

    fun pauseRecording() {
        if (!recording || paused || busy) return
        try {
            recorder.pause()
            millis = recorder.durationMillis
            paused = true
            busy = true
            scope.launch {
                try { preview = recorder.pausedPreview() }
                catch (cancelled: CancellationException) { throw cancelled }
                catch (_: Exception) { error = "Could not prepare the preview. You can still resume or send." }
                finally { busy = false }
            }
        } catch (_: Exception) {
            discard()
            error = "The microphone could not pause."
        }
    }

    fun resumeRecording() {
        if (!paused || busy || millis >= WavePcm.MAX_SECONDS * 1000) return
        stopPreview()
        preview?.file?.delete()
        preview = null
        try {
            recorder.resume()
            paused = false
            error = null
        } catch (_: Exception) {
            discard()
            error = "The microphone could not resume."
        }
    }

    fun send() {
        if (!recording || busy || millis < 1000 || !currentConfig.enabled) return
        stopPreview()
        preview?.file?.delete()
        preview = null
        busy = true
        scope.launch {
            var note: RecordedVoiceNote? = null
            try {
                note = recorder.finish()
                if (note == null) error = "Record at least one second."
                else if (!currentConfig.enabled) error = "Chat is busy. Record again when it is ready."
                else {
                    currentConfig.onReady(note)
                    note = null // Ownership transferred to chat history.
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { error = "Voice recording could not be saved." }
            finally {
                note?.file?.delete()
                recorder.cancel()
                recording = false
                paused = false
                busy = false
            }
        }
    }

    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        if (it) start() else error = "Microphone permission is required. You can still type."
    }
    LaunchedEffect(recording, paused) {
        if (!recording || paused) return@LaunchedEffect
        while (recording && !paused) {
            millis = recorder.durationMillis
            levels = (levels + recorder.amplitude).takeLast(320)
            if (recorder.capturedBytes >= WavePcm.MAX_AUDIO_BYTES) {
                pauseRecording()
                break
            }
            if (recorder.captureFailed) {
                pauseRecording()
                error = "Microphone capture stopped. Review or discard the recording."
                break
            }
            delay(85)
        }
    }
    LaunchedEffect(player, playing) {
        while (playing && player != null) {
            runCatching { position = player?.currentPosition ?: 0 }
            delay(80)
        }
    }
    DisposableEffect(recorder) {
        onDispose {
            previewJob?.cancel()
            recorder.cancel()
            preview?.file?.delete()
        }
    }
    BackHandler(active) { discard() }

    if (!active) {
        Column(Modifier.fillMaxWidth()) {
        normalContent {
            IconButton(enabled = currentConfig.enabled, modifier = Modifier.size(48.dp), onClick = {
                if (!currentConfig.supportsAudio) error = "Select an installed Gemma 4 E2B or E4B model to record voice notes."
                else if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) start()
                else permission.launch(Manifest.permission.RECORD_AUDIO)
            }) {
                Icon(if (currentConfig.supportsAudio) Icons.Outlined.Mic else Icons.Outlined.MicOff, "Record a voice note")
            }
        }
        error?.let {
            Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp)) {
                Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                TextButton(onClick = { error = null }) { Text("Dismiss") }
            }
        }
        }
    } else {
        Column(Modifier.fillMaxWidth().padding(12.dp).testTag("au-inline-voice-recorder"),
            verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (paused) {
                    IconButton(enabled = preview != null && !busy, onClick = {
                        if (playing) stopPreview() else {
                            val path = preview?.file?.absolutePath ?: return@IconButton
                            playing = true
                            position = 0
                            val version = ++previewVersion
                            previewJob = AuAudioPlayback.launch(context, "Preview voice note",
                                onFinished = { if (previewVersion == version) { playing = false; player = null; position = 0 } }) {
                                try { playPrivateVoiceNote(path) { if (previewVersion == version) player = it } }
                                catch (cancelled: CancellationException) { throw cancelled }
                                catch (_: Exception) { error = "Could not play the recording." }
                            }
                        }
                    }) {
                        Icon(if (playing) Icons.Outlined.Stop else Icons.Outlined.PlayArrow,
                            if (playing) "Stop preview" else "Play recording")
                    }
                } else {
                    Icon(Icons.Outlined.Mic, "Recording", tint = MaterialTheme.colorScheme.error, modifier = Modifier.size(24.dp))
                }
                val accent = MaterialTheme.colorScheme.primary
                val muted = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .45f)
                val bars = remember(levels, paused) {
                    if (paused && levels.size > 40) List(40) { index ->
                        val from = index * levels.size / 40
                        val to = (index + 1) * levels.size / 40
                        levels.subList(from, to).maxOrNull() ?: 0f
                    } else List(40) { index -> levels.getOrNull(levels.size - 40 + index) ?: 0f }
                }
                val progress = if (millis > 0) position.toFloat() / millis else 0f
                Canvas(Modifier.weight(1f).height(44.dp).pointerInput(paused, player, millis) {
                    if (paused) detectTapGestures { point ->
                        if (size.width > 0 && millis > 0) runCatching {
                            player?.seekTo((point.x / size.width * millis).toInt().coerceIn(0, millis))
                        }
                    }
                }) {
                    val step = size.width / bars.size
                    bars.forEachIndexed { index, level ->
                        val x = step * (index + .5f)
                        val h = (kotlin.math.sqrt(level.coerceIn(0f, 1f)) * size.height * .9f).coerceAtLeast(2.dp.toPx())
                        drawLine(if (!paused || index.toFloat() / bars.size < progress) accent else muted,
                            Offset(x, (size.height - h) / 2), Offset(x, (size.height + h) / 2),
                            strokeWidth = (step * .52f).coerceAtLeast(1f), cap = StrokeCap.Round)
                    }
                }
                Text("%d:%02d".format(java.util.Locale.ROOT, millis / 60_000, millis / 1000 % 60),
                    style = MaterialTheme.typography.titleMedium)
            }
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilledTonalIconButton(onClick = ::discard, enabled = !busy) {
                    Icon(Icons.Outlined.DeleteOutline, "Discard recording", tint = MaterialTheme.colorScheme.error)
                }
                FilledTonalButton(onClick = { if (paused) resumeRecording() else pauseRecording() },
                    enabled = !busy && !recorder.captureFailed && millis < WavePcm.MAX_SECONDS * 1000,
                    modifier = Modifier.weight(1f), shape = RoundedCornerShape(16.dp)) {
                    Icon(if (paused) Icons.Outlined.Mic else Icons.Outlined.Pause, null)
                    Spacer(Modifier.width(8.dp))
                    Text(if (paused) "Resume" else "Pause")
                }
                FilledIconButton(onClick = ::send, enabled = !busy && millis >= 1000 && currentConfig.enabled) {
                    Icon(Icons.Outlined.Send, "Send recording")
                }
            }
            if (busy) Text("Preparing recording…", style = MaterialTheme.typography.labelSmall)
            else if (millis >= WavePcm.MAX_SECONDS * 1000)
                Text("Recording limit reached. Play, send or discard.", style = MaterialTheme.typography.labelSmall)
            error?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
        }
    }
}

/** Serialize voice notes with read-aloud and podcasts. Release the player on stop,
 * screen disposal, errors and natural completion. Never start overlapping playback. */
private suspend fun playPrivateVoiceNote(path: String, onPlayer: (MediaPlayer?) -> Unit) = suspendCancellableCoroutine<Unit> { continuation ->
    val player = MediaPlayer()
    fun release() { runCatching { player.release() } }
    continuation.invokeOnCancellation { release() }
    try {
        player.setDataSource(path)
        player.setOnPreparedListener { if (continuation.isActive) runCatching { onPlayer(it); it.start() }.onFailure { error ->
            release()
            if (continuation.isActive) continuation.resumeWithException(error)
        } }
        player.setOnCompletionListener {
            release()
            if (continuation.isActive) continuation.resume(Unit)
        }
        player.setOnErrorListener { _, _, _ ->
            release()
            if (continuation.isActive) continuation.resumeWithException(IllegalStateException("Voice note could not play."))
            true
        }
        player.prepareAsync()
    } catch (error: Exception) {
        release()
        if (continuation.isActive) continuation.resumeWithException(error)
    }
}

/** Private voice bubble with an actual stop control. */
@Composable
fun VoiceNotePlayback(audioPath: String, label: String) {
    val context = LocalContext.current
    val valid = remember(audioPath) {
        runCatching {
            val base = java.io.File(context.filesDir, "voice-notes").canonicalFile
            val file = java.io.File(audioPath).canonicalFile
            file.isFile && file.extension == "wav" &&
                file.path.startsWith(base.path + java.io.File.separator)
        }.getOrDefault(false)
    }
    val state = remember(audioPath) { mutableStateOf<Job?>(null) }
    var playing by remember(audioPath) { mutableStateOf(false) }
    var failed by remember(audioPath) { mutableStateOf(false) }
    var player by remember(audioPath) { mutableStateOf<MediaPlayer?>(null) }
    var position by remember(audioPath) { mutableIntStateOf(0) }
    var duration by remember(audioPath) { mutableIntStateOf(0) }
    var dragging by remember(audioPath) { mutableStateOf(false) }
    LaunchedEffect(player, playing) {
        while (playing && player != null) {
            if (!dragging) runCatching { position = player?.currentPosition ?: 0; duration = player?.duration ?: 0 }
            delay(200)
        }
    }
    DisposableEffect(audioPath) { onDispose { state.value?.cancel() } }
    Column(Modifier.fillMaxWidth()) {
    TextButton(
        enabled = valid,
        onClick = {
            if (playing) state.value?.cancel()
            else if (valid) {
                failed = false
                playing = true
                state.value = AuAudioPlayback.launch(context, "Playing voice note",
                    onFinished = { playing = false; state.value = null; player = null; dragging = false }) {
                    try { playPrivateVoiceNote(audioPath) { current -> player = current } }
                    catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled }
                    catch (_: Exception) { failed = true }
                }
            }
        }
    ) {
        Icon(if (playing) Icons.Outlined.Stop else Icons.Outlined.PlayArrow,
            contentDescription = if (playing) "Stop voice note" else "Play voice note")
        Spacer(Modifier.width(7.dp))
        Text(if (failed) "Playback failed · Retry" else if (valid) label else "Voice note unavailable")
    }
    if (playing && duration > 0) {
        Slider(value = position.coerceIn(0,duration).toFloat(), onValueChange = {
            dragging = true; position = it.toInt()
        }, valueRange = 0f..duration.toFloat(), onValueChangeFinished = {
            runCatching { player?.seekTo(position.coerceIn(0,duration)) }
            dragging = false
        }, modifier = Modifier.fillMaxWidth())
        Text("${position / 1000}s / ${duration / 1000}s",style = MaterialTheme.typography.labelSmall)
    }
    }
}
