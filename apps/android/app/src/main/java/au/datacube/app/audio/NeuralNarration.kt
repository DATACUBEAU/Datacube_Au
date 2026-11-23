package au.datacube.app.audio

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Build
import au.datacube.app.models.VerifiedModelDownloads
import com.google.mediapipe.tasks.audio.texttospeech.SynthesisOptions
import com.google.mediapipe.tasks.audio.texttospeech.TextToSpeech
import com.google.mediapipe.tasks.audio.texttospeech.TextToSpeechOptions
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.Delegate
import java.io.File
import java.security.MessageDigest
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/**
 * Opt-in, offline Kokoro 82M neural speech. No microphone, cloud or fake speech.
 * Publisher SHA-256 is checked on loading even after a user imports/restores files.
 */
object NeuralNarration {
    const val MODEL_ID = "kokoro-82m-cpu"
    const val DEFAULT_VOICE = "af_heart"
    val presetVoices = linkedMapOf(
        "af_heart" to "Heart · US",
        "af_bella" to "Bella · US",
        "am_adam" to "Adam · US",
        "bm_george" to "George · UK"
    )

    private val mutex = Mutex()
    @Volatile private var synth: TextToSpeech? = null
    @Volatile private var audio: AudioTrack? = null
    private var loadedPath: String? = null

    fun installed(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false
        val artifact = VerifiedModelDownloads.find(MODEL_ID) ?: return false
        return File(context.filesDir,
            "models/installed/$MODEL_ID/${artifact.fileName}").isFile
    }

    suspend fun speak(
        context: Context,
        text: String,
        voice: String,
        speed: Float,
        onStage: suspend (String) -> Unit = {}
    ) =
        withContext(Dispatchers.IO) {
            require(installed(context)) { "Install Kokoro in Models to use neural voices." }
            require(text.isNotBlank()) { "No narration text." }
            require(voice in presetVoices) { "Select a supported voice." }
            require(speed in 0.7f..1.5f) { "Unsupported narration speed." }
            mutex.withLock {
                currentCoroutineContext().ensureActive()
                onStage("Verifying Kokoro and preparing the on-device engine")
                val task = load(context)
                val segments = NeuralTextSegmenter.split(text)
                require(segments.isNotEmpty()) { "There is no speakable text." }
                val options = SynthesisOptions(voice, null)
                var player: AudioTrack? = null
                var totalSamples = 0L
                try {
                    segments.forEachIndexed { index, segment ->
                        onStage("Generating neural speech ${index + 1} of ${segments.size}")
                        task.synthesizeStream(segment, options).collect { chunk ->
                        currentCoroutineContext().ensureActive()
                        if (chunk.samples.isEmpty()) return@collect
                        val sampleRate = chunk.sampleRateHz
                        require(sampleRate in 16_000..48_000) { "Invalid audio rate." }
                        if (player == null) {
                            val minimum = AudioTrack.getMinBufferSize(
                                sampleRate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_FLOAT
                            )
                            check(minimum > 0) { "Audio output is unavailable." }
                            player = AudioTrack.Builder()
                                .setAudioAttributes(AudioAttributes.Builder()
                                    .setUsage(AudioAttributes.USAGE_MEDIA)
                                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                                    .build())
                                .setAudioFormat(AudioFormat.Builder()
                                    .setEncoding(AudioFormat.ENCODING_PCM_FLOAT)
                                    .setSampleRate(sampleRate)
                                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
                                .setTransferMode(AudioTrack.MODE_STREAM)
                                .setBufferSizeInBytes(maxOf(minimum, 8192))
                                .build()
                            audio = player
                            player?.play()
                            onStage("Playing Kokoro neural narration")
                        }
                        val samples = chunk.samples
                        if (speed != 1f) player?.playbackRate = (sampleRate * speed).toInt()
                        var consumed = 0
                        while (consumed < samples.size) {
                            currentCoroutineContext().ensureActive()
                            val result = player?.write(
                                samples, consumed, samples.size - consumed, AudioTrack.WRITE_BLOCKING
                            ) ?: error("Audio output was stopped.")
                            check(result > 0) { "Audio output failed." }
                            consumed += result
                        }
                        totalSamples += samples.size
                        }
                    }
                    // Draining matters: AudioTrack.write copies to its buffer before playback
                    // completes. Do not truncate the final spoken words after synthesis finishes.
                    val track = player
                    if (track != null) {
                        var polls = 0
                        while (track.playState == AudioTrack.PLAYSTATE_PLAYING &&
                            track.playbackHeadPosition.toLong() < totalSamples && polls++ < 750) {
                            currentCoroutineContext().ensureActive()
                            delay(40)
                        }
                    }
                } catch (cancelled: CancellationException) {
                    task.cancel()
                    throw cancelled
                } finally {
                    player?.let { track ->
                        runCatching { track.pause() }
                        runCatching { track.flush() }
                        runCatching { track.release() }
                    }
                    audio = null
                }
            }
        }

    /** Stop is immediate and never waits for the inference mutex. */
    fun stop() {
        runCatching { synth?.cancel() }
        runCatching { audio?.pause() }
        runCatching { audio?.flush() }
    }

    /** Release the large neural engine when its screen is no longer visible. */
    suspend fun release() = withContext(Dispatchers.IO) {
        mutex.withLock {
            stop()
            runCatching { synth?.close() }
            synth = null
            loadedPath = null
        }
    }

    private suspend fun load(context: Context): TextToSpeech {
        val artifact = requireNotNull(VerifiedModelDownloads.find(MODEL_ID))
        val model = File(context.filesDir,
            "models/installed/$MODEL_ID/${artifact.fileName}")
        check(model.isFile) { "Kokoro model is missing." }
        if (loadedPath != model.absolutePath || synth == null) {
            synth?.close()
            synth = null
            loadedPath = null
            check(sha256(model) == artifact.sha256) {
                "Kokoro checksum failed. Restore or download the verified model."
            }
            val base = BaseOptions.builder()
                .setModelAssetPath(model.absolutePath)
                .setDelegate(Delegate.CPU)
                .build()
            val options = TextToSpeechOptions(
                baseOptions = base,
                defaultVoiceId = DEFAULT_VOICE,
                defaultLocale = null,
                speakingRate = 1.0f,
                targetBucket = 64,
                cacheDir = context.cacheDir.absolutePath
            )
            synth = TextToSpeech.create(options)
            loadedPath = model.absolutePath
        }
        return requireNotNull(synth)
    }

    private suspend fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().buffered().use { input ->
            val data = ByteArray(128 * 1024)
            while (true) {
                currentCoroutineContext().ensureActive()
                val size = input.read(data)
                if (size < 0) break
                if (size > 0) digest.update(data, 0, size)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }
}
