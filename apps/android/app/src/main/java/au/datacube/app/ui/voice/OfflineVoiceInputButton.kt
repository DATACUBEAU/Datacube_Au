package au.datacube.app.ui.voice

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.MicOff
import androidx.compose.material.icons.outlined.Stop
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat

/**
 * Dictation is explicit, local-only and never auto-sends a question.
 * Uses Android 12+ createOnDeviceSpeechRecognizer; never substitutes the
 * default/network recognizer or initiates a model download.
 */
@Composable
fun OfflineVoiceInputButton(
    enabled: Boolean,
    onTranscript: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val supported = remember(context) {
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
            runCatching { SpeechRecognizer.isOnDeviceRecognitionAvailable(context) }
                .getOrDefault(false)
    }
    val latestTranscript by rememberUpdatedState(onTranscript)
    var listening by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf<String?>(null) }
    val recognizerRef = remember { mutableStateOf<SpeechRecognizer?>(null) }

    fun cleanup() {
        recognizerRef.value?.destroy()
        recognizerRef.value = null
        listening = false
    }

    fun start() {
        if (!supported || listening || !enabled) return
        try {
            val recognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
            recognizerRef.value = recognizer
            recognizer.setRecognitionListener(object : RecognitionListener {
                override fun onReadyForSpeech(params: Bundle?) = Unit
                override fun onBeginningOfSpeech() = Unit
                override fun onRmsChanged(rmsdB: Float) = Unit
                override fun onBufferReceived(buffer: ByteArray?) = Unit
                override fun onEndOfSpeech() = Unit
                override fun onPartialResults(partialResults: Bundle?) = Unit
                override fun onEvent(eventType: Int, params: Bundle?) = Unit

                override fun onError(error: Int) {
                    cleanup()
                    notice = when (error) {
                        SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT ->
                            "No speech recognized. Try again or type your question."
                        SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED,
                        SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE ->
                            "This language is not installed for offline recognition. Type your question."
                        else -> "Offline recognition failed. You can type your question instead."
                    }
                }

                override fun onResults(results: Bundle?) {
                    val transcript = results
                        ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                        ?.firstOrNull()?.trim().orEmpty()
                    cleanup()
                    if (transcript.isNotBlank()) {
                        latestTranscript(transcript)
                    } else {
                        notice = "No speech recognized. You can type your question."
                    }
                }
            })
            recognizer.startListening(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                    RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
                putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            })
            listening = true
        } catch (_: Exception) {
            cleanup()
            notice = "Offline recognition could not start on this device."
        }
    }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) start()
        else notice = "Microphone permission was declined. Text input still works."
    }
    DisposableEffect(context) {
        onDispose {
            recognizerRef.value?.cancel()
            recognizerRef.value?.destroy()
            recognizerRef.value = null
        }
    }

    if (notice != null) {
        AlertDialog(
            onDismissRequest = { notice = null },
            title = { Text("Offline voice input") },
            text = { Text(notice.orEmpty()) },
            confirmButton = { TextButton(onClick = { notice = null }) { Text("OK") } }
        )
    }

    IconButton(
        modifier = modifier.size(48.dp),
        enabled = enabled,
        onClick = {
            if (listening) {
                recognizerRef.value?.cancel()
                cleanup()
            } else if (!supported) {
                notice = "Offline speech input is unavailable on this device. " +
                    "DataCube AU will not use an online speech recognizer."
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
            imageVector = if (listening) Icons.Outlined.Stop
                else if (supported) Icons.Outlined.Mic else Icons.Outlined.MicOff,
            contentDescription = if (listening) "Stop offline dictation"
                else if (supported) "Dictate a question offline"
                else "Offline voice input unavailable"
        )
    }
}
