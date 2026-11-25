package au.datacube.app.ui.voice

import android.Manifest
import android.content.pm.PackageManager
import android.media.MediaPlayer
import au.datacube.app.audio.AuAudioPlayback
import kotlinx.coroutines.Job
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.MicOff
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.Stop
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import au.datacube.app.ui.common.DataCubeDialog
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** WhatsApp-like voice note: record, review, then explicitly send. */
@Composable
fun VoiceNoteInputButton(
    ownerId: String,
    enabled: Boolean,
    supportsAudio: Boolean,
    onReady: (RecordedVoiceNote) -> Unit,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val recorder = remember(context, ownerId) { LocalVoiceNoteRecorder(context, ownerId) }
    var recording by remember(ownerId) { mutableStateOf(false) }
    var seconds by remember(ownerId) { mutableIntStateOf(0) }
    val pendingVoice = remember(ownerId) { mutableStateOf<RecordedVoiceNote?>(null) }
    var preview by pendingVoice
    var finishing by remember(ownerId) { mutableStateOf(false) }
    var error by remember(ownerId) { mutableStateOf<String?>(null) }

    fun start() {
        if (!enabled || recording || finishing || preview != null) return
        try {
            recorder.start(scope)
            seconds = 0
            recording = true
        } catch (_: Exception) {
            recording = false
            error = "The microphone could not start. Check microphone permission and device audio settings."
        }
    }

    fun stop() {
        if (!recording || finishing) return
        recording = false
        finishing = true
        scope.launch {
            try {
                val note = recorder.finish()
                if (note == null) error = "The voice note was too short. Record at least one second."
                else preview = note
            } catch (_: Exception) {
                error = "Voice recording could not be saved."
                recorder.cancel()
            } finally {
                finishing = false
            }
        }
    }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { allowed ->
        if (allowed) start()
        else error = "Microphone access is required to record voice notes. Text chat still works."
    }

    LaunchedEffect(recording) {
        if (!recording) return@LaunchedEffect
        while (recording && seconds < WavePcm.MAX_SECONDS) {
            delay(1_000)
            seconds++
        }
        if (recording) stop()
    }

    DisposableEffect(ownerId) {
        onDispose {
            recorder.cancel()
            pendingVoice.value?.file?.delete()
        }
    }

    preview?.let { note ->
        DataCubeDialog(
            onDismissRequest = {
                note.file.delete()
                preview = null
            },
            title = {
                Text("Your voice note", style = MaterialTheme.typography.titleLarge)
            },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("${note.durationSeconds}s recorded privately on this device",
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text("Send this audio to AU. Your selected Gemma model will listen and answer; the app won't replace your voice note with text.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        VoiceNotePlayback(note.file.absolutePath, "Preview recording")
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    preview = null
                    onReady(note)
                }) { Text("Send voice note") }
            },
            dismissButton = {
                TextButton(onClick = {
                    note.file.delete()
                    preview = null
                }) { Text("Discard") }
            }
        )
    }

    error?.let { message ->
        DataCubeDialog(
            onDismissRequest = { error = null },
            title = { Text("Voice notes") },
            text = { Text(message) },
            confirmButton = { TextButton(onClick = { error = null }) { Text("OK") } }
        )
    }

    Row(verticalAlignment = Alignment.CenterVertically, modifier = modifier) {
        IconButton(
            enabled = enabled && !finishing,
            modifier = Modifier.size(48.dp),
            onClick = {
                if (recording) stop()
                else if (!supportsAudio) {
                    error = "Select and download a Gemma 4 E2B or E4B model in Models. Other chat models cannot listen to voice notes."
                } else if (ContextCompat.checkSelfPermission(
                        context, Manifest.permission.RECORD_AUDIO
                    ) == PackageManager.PERMISSION_GRANTED) {
                    start()
                } else {
                    permissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
                }
            }
        ) {
            Icon(
                if (recording) Icons.Outlined.Stop
                else if (supportsAudio) Icons.Outlined.Mic
                else Icons.Outlined.MicOff,
                contentDescription = if (recording) "Stop voice note recording"
                    else "Record a voice note"
            )
        }
        if (recording) {
            Text("${seconds}s", style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.error)
        }
    }
}

/** Serialize voice notes with read-aloud and podcasts. Release the player on stop,
 * screen disposal, errors and natural completion. Never start overlapping playback. */
private suspend fun playPrivateVoiceNote(path: String) = suspendCancellableCoroutine<Unit> { continuation ->
    val player = MediaPlayer()
    fun release() { runCatching { player.release() } }
    continuation.invokeOnCancellation { release() }
    try {
        player.setDataSource(path)
        player.setOnPreparedListener { if (continuation.isActive) runCatching { it.start() }.onFailure { error ->
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
    DisposableEffect(audioPath) { onDispose { state.value?.cancel() } }
    TextButton(
        enabled = valid,
        onClick = {
            if (playing) state.value?.cancel()
            else if (valid) {
                failed = false
                playing = true
                state.value = AuAudioPlayback.launch(context, "Playing voice note",
                    onFinished = { playing = false; state.value = null }) {
                    try { playPrivateVoiceNote(audioPath) }
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
}
