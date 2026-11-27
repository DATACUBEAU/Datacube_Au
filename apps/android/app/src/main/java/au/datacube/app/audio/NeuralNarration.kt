package au.datacube.app.audio

import au.datacube.app.data.rag.LocalComputeGate

import android.content.Context
import au.datacube.app.notifications.LocalNotificationService
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
import java.io.RandomAccessFile
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.async
import java.security.MessageDigest
import java.util.concurrent.Executors
import kotlinx.coroutines.asCoroutineDispatcher
import android.os.SystemClock
import android.util.Log
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

    // GPU task construction, inference and disposal stay on the same thread.
    private val speechDispatcher = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "au-neural-speech").apply { isDaemon = true }
    }.asCoroutineDispatcher()
    private val mutex = Mutex()
    private var loadedDelegate: Delegate? = null
    private var gpuRejected = false
    @Volatile private var synth: TextToSpeech? = null
    @Volatile private var audio: AudioTrack? = null
    private var loadedPath: String? = null

    fun installed(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false
        val artifact = VerifiedModelDownloads.find(MODEL_ID) ?: return false
        return File(context.filesDir,
            "models/installed/$MODEL_ID/${artifact.fileName}").isFile
    }

    private data class SpeechPart(val text: String, val voice: String, val speaker: Int)

    suspend fun speak(
        context: Context, text: String, voice: String, speed: Float,
        onProgress: suspend (Long, Long) -> Unit = { _, _ -> },
        onStage: suspend (String) -> Unit = {}
    ) {
        val parts = NeuralTextSegmenter.split(text, maxChunk = 600, maxText = 12_000)
            .map { SpeechPart(it, voice, 0) }
        renderAndPlay(context, parts, speed, {}, onStage, onProgress)
    }

    /** Render one private WAV for the reusable message player, without playing it. */
    suspend fun prepareReadAloud(context: Context, text: String, voice: String, destination: File,
        onStage: suspend (String) -> Unit = {}) {
        val parts = NeuralTextSegmenter.split(text, maxChunk = 600, maxText = 12_000).map { SpeechPart(it, voice, 0) }
        renderAndPlay(context, parts, 1f, {}, onStage, destination = destination)
    }

    suspend fun speakDialogue(
        context: Context, turns: List<PodcastTurn>, speed: Float,
        onSpeaker: suspend (Int) -> Unit,
        onStage: suspend (String) -> Unit = {}
    ) {
        require(turns.size in 1..PodcastDialogue.MAX_TURNS) { "Prepare a valid discussion first." }
        val parts = turns.flatMapIndexed { index, turn ->
            NeuralTextSegmenter.split(turn.text, maxChunk = 1000, maxText = 2000).map {
                SpeechPart(it, PodcastDialogue.voiceFor(turn.speaker), index)
            }
        }
        renderAndPlay(context, parts, speed, onSpeaker, onStage)
    }

    /** Adaptive message playback also writes the finished WAV for subsequent seeks/replays. */
    suspend fun playAndCacheReadAloud(context: Context, text: String, voice: String, speed: Float,
        destination: File, onStage: suspend (String) -> Unit,
        onProgress: suspend (Long, Long) -> Unit, onStarted: suspend () -> Unit,
        isPaused: () -> Boolean) {
        val parts = NeuralTextSegmenter.split(text, maxChunk = 600, maxText = 12_000)
            .map { SpeechPart(it, voice, 0) }
        renderAndPlay(context, parts, speed, {}, onStage, onProgress, destination,
            playWhilePreparing = true, onStarted = onStarted, isPaused = isPaused)
    }

    private data class PublishedAudio(
        val rate: Int = 0, val samples: Long = 0, val completedChars: Int = 0,
        val synthesisSeconds: Double = 0.0, val boundaries: List<Pair<Long, Int>> = emptyList(),
        val complete: Boolean = false
    )

    /**
     * Producer uses the existing thread-affine Kokoro runtime. Consumer reads
     * only flushed PCM from disk on a separate dispatcher. Slow devices wait
     * for the entire render; fast devices can safely start with an adaptive lead.
     */
    private suspend fun renderAndPlay(
        context: Context, parts: List<SpeechPart>, speed: Float,
        onSpeaker: suspend (Int) -> Unit,
        onStage: suspend (String) -> Unit,
        onProgress: suspend (Long, Long) -> Unit = { _, _ -> },
        destination: File? = null,
        playWhilePreparing: Boolean = false,
        onStarted: suspend () -> Unit = {},
        isPaused: () -> Boolean = { false }
    ) = withContext(speechDispatcher) {
        require(installed(context)) { "Install Kokoro in Models to use neural voices." }
        require(parts.isNotEmpty() && parts.all { it.voice in presetVoices })
        require(speed in 0.7f..1.5f)
        mutex.withLock {
            val app = context.applicationContext
            val pcm = File.createTempFile("au-narration-", ".pcm", app.cacheDir)
            val published = AtomicReference(PublishedAudio())
            val totalChars = parts.sumOf { it.text.length }
            val shouldPlay = destination == null || playWhilePreparing
            try {
                coroutineScope {
                    val consumer = if (shouldPlay) async(Dispatchers.IO) {
                        consumeAudio(pcm, published, totalChars, speed, onSpeaker, onStage,
                            onProgress, onStarted, isPaused)
                    } else null
                    var task: TextToSpeech? = null
                    suspend fun prepareAudio() {
                        var rate = 0
                        var samples = 0L
                        var completedChars = 0
                        var synthesisNanos = 0L
                        val boundaries = mutableListOf<Pair<Long, Int>>()
                        pcm.outputStream().buffered().use { output ->
                            parts.forEachIndexed { index, part ->
                                currentCoroutineContext().ensureActive()
                                if (boundaries.lastOrNull()?.second != part.speaker)
                                    boundaries += samples to part.speaker
                                val began = System.nanoTime()
                                val before = samples
                                checkNotNull(task).synthesizeStream(part.text, SynthesisOptions(part.voice, null)).collect { chunk ->
                                    currentCoroutineContext().ensureActive()
                                    if (chunk.samples.isEmpty()) return@collect
                                    require(chunk.sampleRateHz in 16_000..48_000)
                                    if (rate == 0) rate = chunk.sampleRateHz
                                    check(rate == chunk.sampleRateHz) { "Audio sample rate changed." }
                                    samples += chunk.samples.size
                                    check(samples <= 64L * 1024 * 1024) { "Audio is too long to prepare." }
                                    val bytes = ByteArray(chunk.samples.size * 2)
                                    chunk.samples.forEachIndexed { i, sample ->
                                        val value = (sample.coerceIn(-1f, 1f) * 32767f).toInt()
                                        bytes[i * 2] = value.toByte()
                                        bytes[i * 2 + 1] = (value shr 8).toByte()
                                    }
                                    output.write(bytes)
                                }
                                check(samples > before) { "A speech segment returned no audio." }
                                output.flush()
                                synthesisNanos += System.nanoTime() - began
                                completedChars += part.text.length
                                published.set(PublishedAudio(rate, samples, completedChars,
                                    synthesisNanos / 1_000_000_000.0, boundaries.toList()))
                                if (!shouldPlay) onStage("Preparing audio ${index + 1} of ${parts.size}")
                            }
                        }
                        check(rate > 0 && samples > 0) { "No audio was generated." }
                    }

                    onStage("Preparing neural audio")
                    LocalComputeGate.mutex.withLock {
                        LocalComputeGate.prepare(app, LocalComputeGate.Engine.SPEECH)
                        try {
                            task = load(app)
                            prepareAudio()
                        } catch (cancelled: CancellationException) {
                            runCatching { task?.cancel() }
                            throw cancelled
                        } catch (failure: Exception) {
                            // Restart only if nothing has been published for playback.
                            if (loadedDelegate != Delegate.GPU || published.get().samples > 0) throw failure
                            gpuRejected = true
                            onStage("Preparing audio with compatible engine")
                            closeEngine()
                            task = load(app)
                            prepareAudio()
                        } finally {
                            closeEngine()
                            task = null
                        }
                    }
                    val finished = published.get()
                    if (destination != null) writeWaveFile(pcm, destination, finished.rate, finished.samples)
                    published.set(finished.copy(complete = true))
                    Log.i("AuNeuralSpeech", "synthesisSeconds=${finished.synthesisSeconds} audioSeconds=${finished.samples.toDouble() / finished.rate}")
                    consumer?.await()
                }
            } finally {
                pcm.delete()
            }
        }
    }

    private suspend fun consumeAudio(
        pcm: File, published: AtomicReference<PublishedAudio>, totalChars: Int, speed: Float,
        onSpeaker: suspend (Int) -> Unit, onStage: suspend (String) -> Unit,
        onProgress: suspend (Long, Long) -> Unit, onStarted: suspend () -> Unit, isPaused: () -> Boolean
    ) {
        var snapshot = published.get()
        while (!AdaptiveSpeechBuffer.canStart(
                if (snapshot.rate == 0) 0.0 else snapshot.samples.toDouble() / snapshot.rate,
                snapshot.synthesisSeconds, snapshot.completedChars, totalChars, speed, snapshot.complete)) {
            currentCoroutineContext().ensureActive()
            delay(80)
            snapshot = published.get()
        }
        val rate = snapshot.rate
        val minimum = AudioTrack.getMinBufferSize(rate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
        check(minimum > 0)
        val track = AudioTrack.Builder()
            .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
            .setAudioFormat(AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setSampleRate(rate).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
            .setTransferMode(AudioTrack.MODE_STREAM)
            .setBufferSizeInBytes(maxOf(minimum, rate))
            .build()
        audio = track
        try {
            check(track.state == AudioTrack.STATE_INITIALIZED)
            var actualSpeed = speed
            if (speed != 1f) try {
                track.playbackParams = android.media.PlaybackParams().setSpeed(speed).setPitch(1f)
            } catch (_: IllegalArgumentException) {
                actualSpeed = 1f
                Log.w("AuNeuralSpeech", "Pitch-preserving speed unsupported; using normal speed")
            }
            // Some devices start automatically when PlaybackParams are applied.
            if (track.playState == AudioTrack.PLAYSTATE_PLAYING) track.pause()
            var submitted = 0L
            var speaker = -1
            var lastProgress = 0L
            var lastStage = ""
            suspend fun stage(value: String) {
                if (lastStage != value) { lastStage = value; onStage(value) }
            }
            fun head(): Long = track.playbackHeadPosition.toLong() and 0xffffffffL
            suspend fun progress(force: Boolean = false) {
                val now = SystemClock.elapsedRealtime()
                val current = published.get()
                val position = head().coerceAtMost(current.samples)
                if (force || now - lastProgress >= 150L) {
                    onProgress(position * 1000 / rate, current.samples * 1000 / rate)
                    lastProgress = now
                }
                val next = current.boundaries.lastOrNull { it.first <= position }?.second ?: 0
                if (next != speaker) { speaker = next; onSpeaker(next) }
            }

            RandomAccessFile(pcm, "r").use { input ->
                val buffer = ByteArray(8192)
                // Pre-fill the platform buffer before starting playback.
                val prime = minOf(buffer.size.toLong(), snapshot.samples * 2).toInt()
                input.readFully(buffer, 0, prime)
                val primed = track.write(buffer, 0, prime, AudioTrack.WRITE_NON_BLOCKING)
                check(primed >= 0 && primed % 2 == 0)
                submitted = primed / 2L
                input.seek(submitted * 2)
                track.play()
                onStarted()
                stage("Playing neural audio")
                while (true) {
                    currentCoroutineContext().ensureActive()
                    val current = published.get()
                    val played = head()
                    if (current.complete && played >= current.samples) break
                    if (isPaused()) {
                        if (track.playState == AudioTrack.PLAYSTATE_PLAYING) track.pause()
                        stage("Paused")
                        delay(50)
                        continue
                    }
                    val available = current.samples - played
                    // Pause before the hardware buffer runs dry. Never jump past
                    // missing samples or replay an already submitted byte.
                    val rebuffer = !current.complete && available < rate / 3L
                    if (rebuffer || (track.playState != AudioTrack.PLAYSTATE_PLAYING &&
                            !current.complete && available < AdaptiveSpeechBuffer.refillSamples(rate, actualSpeed))) {
                        if (track.playState == AudioTrack.PLAYSTATE_PLAYING) track.pause()
                        stage("Buffering neural audio")
                        delay(50)
                        continue
                    }
                    if (track.playState != AudioTrack.PLAYSTATE_PLAYING) track.play()
                    stage("Playing neural audio")
                    val remaining = current.samples - submitted
                    if (remaining > 0) {
                        val size = minOf(buffer.size.toLong(), remaining * 2).toInt()
                        input.seek(submitted * 2)
                        input.readFully(buffer, 0, size)
                        val written = track.write(buffer, 0, size, AudioTrack.WRITE_NON_BLOCKING)
                        check(written >= 0 && written % 2 == 0) { "Audio output stopped." }
                        submitted += written / 2
                        if (written == 0) delay(20)
                    } else delay(25)
                    progress()
                }
            }
            progress(true)
        } finally {
            runCatching { track.pause() }
            runCatching { track.flush() }
            runCatching { track.release() }
            audio = null
        }
    }

    /** PCM stays on disk. Do not allocate the entire waveform in memory. */
    private suspend fun writeWaveFile(pcm: File, destination: File, rate: Int, samples: Long) {
        val bytes = samples * 2
        require(bytes in 2..128L * 1024 * 1024)
        val header = java.nio.ByteBuffer.allocate(44).order(java.nio.ByteOrder.LITTLE_ENDIAN)
        header.put("RIFF".toByteArray(Charsets.US_ASCII)).putInt((36 + bytes).toInt())
        header.put("WAVEfmt ".toByteArray(Charsets.US_ASCII)).putInt(16)
        header.putShort(1.toShort()).putShort(1.toShort()).putInt(rate).putInt(rate * 2)
        header.putShort(2.toShort()).putShort(16.toShort())
        header.put("data".toByteArray(Charsets.US_ASCII)).putInt(bytes.toInt())
        destination.outputStream().buffered().use { output ->
            output.write(header.array())
            pcm.inputStream().buffered().use { input ->
                val buffer = ByteArray(64 * 1024)
                while (true) {
                    currentCoroutineContext().ensureActive()
                    val count = input.read(buffer)
                    if (count < 0) break
                    output.write(buffer, 0, count)
                }
            }
        }
        check(destination.length() == bytes + 44)
    }

    /** Stop is immediate and never waits for the inference mutex. */
    fun stop() {
        runCatching { synth?.cancel() }
        runCatching { audio?.pause() }
        runCatching { audio?.flush() }
    }

    /** Release the large neural engine when its screen is no longer visible. */
    suspend fun release() = withContext(speechDispatcher) {
        mutex.withLock {
            stop()
            closeEngine()
        }
    }

    private fun closeEngine() {
        runCatching { synth?.close() }
        synth = null
        loadedPath = null
        loadedDelegate = null
    }

    private suspend fun load(context: Context): TextToSpeech {
        val artifact = requireNotNull(VerifiedModelDownloads.find(MODEL_ID))
        val model = File(context.filesDir,
            "models/installed/$MODEL_ID/${artifact.fileName}")
        check(model.isFile) { "Kokoro model is missing." }
        if (loadedPath != model.absolutePath || synth == null) {
            closeEngine()
            check(sha256(model) == artifact.sha256) {
                "Kokoro checksum failed. Restore or download the verified model."
            }
            fun create(delegate: Delegate): TextToSpeech {
                val base = BaseOptions.builder()
                    .setModelAssetPath(model.absolutePath)
                    .setDelegate(delegate)
                    .build()
                val options = TextToSpeechOptions(
                    baseOptions = base,
                    defaultVoiceId = DEFAULT_VOICE,
                    defaultLocale = null,
                    speakingRate = 1.0f,
                    targetBucket = 64,
                    cacheDir = context.cacheDir.absolutePath
                )
                return TextToSpeech.create(options)
            }
            val canTryGpu = !gpuRejected && Build.SUPPORTED_ABIS.firstOrNull() == "arm64-v8a"
            if (canTryGpu) {
                try {
                    synth = create(Delegate.GPU)
                    loadedDelegate = Delegate.GPU
                } catch (failure: Exception) {
                    gpuRejected = true
                    Log.w("AuNeuralSpeech", "GPU initialization unavailable; using CPU")
                }
            }
            if (synth == null) {
                synth = create(Delegate.CPU)
                loadedDelegate = Delegate.CPU
            }
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
