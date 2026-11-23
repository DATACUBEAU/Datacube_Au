package au.datacube.app.ui.voice

import android.content.Context
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.SystemClock
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.util.UUID
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.joinAll
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class RecordedVoiceNote(val file: File, val durationSeconds: Int)

/** 16 kHz, mono, PCM16 WAV is accepted by LiteRT-LM multimodal audio models. */
internal object WavePcm {
    const val SAMPLE_RATE = 16_000
    const val CHANNELS = 1
    const val BYTES_PER_SAMPLE = 2
    const val MAX_SECONDS = 25
    const val MAX_AUDIO_BYTES = SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE * MAX_SECONDS

    fun header(dataBytes: Int): ByteArray {
        require(dataBytes in 0..MAX_AUDIO_BYTES)
        val bytes = ByteArray(44)
        fun ascii(offset: Int, value: String) =
            value.forEachIndexed { i, ch -> bytes[offset + i] = ch.code.toByte() }
        fun le(offset: Int, size: Int, value: Int) {
            for (i in 0 until size) bytes[offset + i] = (value ushr (i * 8)).toByte()
        }
        ascii(0, "RIFF")
        le(4, 4, 36 + dataBytes)
        ascii(8, "WAVE")
        ascii(12, "fmt ")
        le(16, 4, 16)
        le(20, 2, 1)
        le(22, 2, CHANNELS)
        le(24, 4, SAMPLE_RATE)
        le(28, 4, SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE)
        le(32, 2, CHANNELS * BYTES_PER_SAMPLE)
        le(34, 2, 16)
        ascii(36, "data")
        le(40, 4, dataBytes)
        return bytes
    }
}

/**
 * Explicit user-controlled recording. Stores short WAV notes only in the
 * application's private files directory and never uploads microphone audio.
 * The owner ID is a document ID or authenticated Discs owner.
 */
class LocalVoiceNoteRecorder(context: Context, ownerId: String) {
    private val root = File(context.applicationContext.filesDir, "voice-notes/$ownerId")
    private var track: AudioRecord? = null
    private var recordingJob: Job? = null
    private var partial: File? = null
    private var startedAt = 0L
    @Volatile private var running = false

    init { require(ownerId.matches(Regex("[A-Za-z0-9_-]{1,80}"))) }

    fun start(scope: CoroutineScope) {
        check(track == null && recordingJob == null) { "Recording is already active." }
        check(root.mkdirs() || root.isDirectory) { "Cannot create private voice-note storage." }
        val capacity = maxOf(
            AudioRecord.getMinBufferSize(
                WavePcm.SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT
            ), 4_096
        )
        check(capacity in 4096..256_000) { "Device cannot capture the required audio format." }
        val recorder = AudioRecord(
            MediaRecorder.AudioSource.MIC,
            WavePcm.SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
            capacity
        )
        if (recorder.state != AudioRecord.STATE_INITIALIZED) {
            recorder.release()
            error("Microphone initialization failed.")
        }
        val file = File(root, UUID.randomUUID().toString() + ".part")
        try {
            recorder.startRecording()
        } catch (error: Exception) {
            recorder.release()
            throw error
        }
        startedAt = SystemClock.elapsedRealtime()
        partial = file
        track = recorder
        running = true
        recordingJob = scope.launch(Dispatchers.IO) {
            val buffer = ByteArray(capacity)
            FileOutputStream(file).use { output ->
                while (running &&
                    (SystemClock.elapsedRealtime() - startedAt) < WavePcm.MAX_SECONDS * 1000L &&
                    file.length() < WavePcm.MAX_AUDIO_BYTES) {
                    currentCoroutineContext().ensureActive()
                    val count = try {
                        recorder.read(buffer, 0, buffer.size, AudioRecord.READ_BLOCKING)
                    } catch (_: IllegalStateException) {
                        break
                    }
                    if (count <= 0) break
                    output.write(buffer, 0, minOf(count, WavePcm.MAX_AUDIO_BYTES - file.length().toInt()))
                }
            }
        }
    }

    suspend fun finish(): RecordedVoiceNote? = withContext(Dispatchers.IO) {
        val source = partial ?: return@withContext null
        running = false
        runCatching { track?.stop() }
        recordingJob?.join()
        track?.release()
        track = null
        recordingJob = null
        partial = null
        val bytes = source.length().toInt()
        if (bytes < WavePcm.SAMPLE_RATE * WavePcm.BYTES_PER_SAMPLE / 2 ||
            bytes > WavePcm.MAX_AUDIO_BYTES) {
            source.delete()
            return@withContext null
        }
        val output = File(root, source.nameWithoutExtension + ".wav")
        try {
            FileOutputStream(output).use { target ->
                target.write(WavePcm.header(bytes))
                FileInputStream(source).use { it.copyTo(target) }
            }
            require(output.length() == bytes + 44L) { "Voice note could not be finalized." }
            RecordedVoiceNote(
                file = output,
                durationSeconds = (bytes / (WavePcm.SAMPLE_RATE * WavePcm.BYTES_PER_SAMPLE))
                    .coerceAtLeast(1)
            )
        } catch (error: Exception) {
            output.delete()
            throw error
        } finally {
            source.delete()
        }
    }

    fun cancel() {
        running = false
        runCatching { track?.stop() }
        recordingJob?.cancel()
        runCatching { track?.release() }
        track = null
        recordingJob = null
        partial?.delete()
        partial = null
    }

    companion object {
        fun clearOwner(filesDir: File, ownerId: String) {
            require(ownerId.matches(Regex("[A-Za-z0-9_-]{1,80}")))
            File(filesDir, "voice-notes/$ownerId").deleteRecursively()
        }
    }
}
