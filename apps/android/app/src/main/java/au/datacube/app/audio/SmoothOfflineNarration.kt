package au.datacube.app.audio

import android.content.Context
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import java.util.Locale
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Low-latency system speech using only voices installed on the device.
 * One natural offline voice is preferable to lengthy pauses between neural
 * segments on low-memory phones. Never selects network-required voices.
 */
object SmoothOfflineNarration {
    private val mutex = Mutex()
    @Volatile private var active: TextToSpeech? = null
    private var warmEngine: TextToSpeech? = null
    private var warmPackage: String? = null

    private suspend fun engine(context: Context, enginePackage: String?): TextToSpeech {
        warmEngine?.let { if (warmPackage == enginePackage) return it }
        closeWarmEngine()
        val ready = CompletableDeferred<Boolean>()
        val tts = withContext(Dispatchers.Main.immediate) {
            if (enginePackage == null) TextToSpeech(context.applicationContext) { status ->
                ready.complete(status == TextToSpeech.SUCCESS)
            } else TextToSpeech(context.applicationContext, { status ->
                ready.complete(status == TextToSpeech.SUCCESS)
            }, enginePackage)
        }
        try {
            check(withTimeout(8_000) { ready.await() }) { "Android's offline speech engine is not available." }
            warmEngine = tts
            warmPackage = enginePackage
            return tts
        } catch (failure: Throwable) {
            withContext(NonCancellable + Dispatchers.Main.immediate) { tts.shutdown() }
            if (failure is TimeoutCancellationException) {
                throw IllegalStateException("Android offline speech initialization timed out.", failure)
            }
            throw failure
        }
    }

    private suspend fun closeWarmEngine() {
        val old = warmEngine
        warmEngine = null
        warmPackage = null
        withContext(NonCancellable + Dispatchers.Main.immediate) { old?.shutdown() }
    }

    /** Preconnect only, never synthesize or play unrequested speech. */
    suspend fun warm(context: Context) = mutex.withLock {
        try { engine(context, null); Unit }
        catch (timeout: TimeoutCancellationException) { Unit }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { Unit }
    }

    suspend fun releaseIdle() {
        if (!mutex.tryLock()) return
        try { closeWarmEngine() } finally { mutex.unlock() }
    }

    private data class Pending(
        val started: CompletableDeferred<Unit> = CompletableDeferred(),
        val done: CompletableDeferred<Unit> = CompletableDeferred()
    )

    suspend fun speakDialogue(
        context: Context,
        turns: List<PodcastTurn>,
        speed: Float,
        onSpeaker: suspend (Int) -> Unit,
        onStage: suspend (String) -> Unit,
        distinguishSpeakers: Boolean = false,
        enginePackage: String? = null,
        renderDirectory: java.io.File? = null
    ) = mutex.withLock {
        require(turns.isNotEmpty()) { "Create an audio conversation first." }
        val app = context.applicationContext
        // Both direct narration and podcasts use the same word-safe planner.
        // Keep each utterance tied to the original UI speaker/turn index.
        val spoken = turns.flatMapIndexed { index, turn ->
            NeuralTextSegmenter.plan(turn.text, maxChunk = 1000, maxText = 12000)
                .map { index to turn.copy(text = it.text) }
        }
        require(spoken.isNotEmpty()) { "No readable speech was found." }
        val tts = engine(app, enginePackage)
        active = tts
        val pending = ConcurrentHashMap<String, Pending>()
        val session = UUID.randomUUID().toString()
        fun id(index: Int) = "$session-$index"
        var failed = false
        try {
            val offline = tts.voices.orEmpty()
                .filter { !it.isNetworkConnectionRequired }
                .sortedWith(compareByDescending<android.speech.tts.Voice> {
                    it.locale.language == Locale.getDefault().language
                }.thenByDescending { it.quality }.thenBy { it.latency }.thenBy { it.name })
            require(offline.isNotEmpty()) { "No offline voice is installed. Add one in Android Text-to-speech settings." }
            val preference = OfflineNarrationPreferences(app)
            val voice = offline.firstOrNull { it.name == preference.voiceName } ?: offline.first()
            val secondVoice = offline.firstOrNull {
                it.name != voice.name && it.locale.language == voice.locale.language
            } ?: voice
            tts.setSpeechRate(speed.coerceIn(0.7f, 1.4f))
            tts.setPitch(preference.pitch)
            tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(utteranceId: String?) {
                    utteranceId?.let { pending[it]?.started?.complete(Unit) }
                }
                override fun onDone(utteranceId: String?) {
                    val item = utteranceId?.let { pending[it] } ?: return
                    item.started.complete(Unit)
                    item.done.complete(Unit)
                }
                private fun fail(id: String?, error: Throwable) {
                    val item = id?.let { pending[it] } ?: return
                    item.started.completeExceptionally(error)
                    item.done.completeExceptionally(error)
                }
                @Deprecated("Overload required for older Android engines")
                override fun onError(utteranceId: String?) =
                    fail(utteranceId, IllegalStateException("Android offline speech failed."))
                override fun onError(utteranceId: String?, errorCode: Int) =
                    fail(utteranceId, IllegalStateException("Android offline speech failed ($errorCode)."))
                override fun onStop(utteranceId: String?, interrupted: Boolean) =
                    fail(utteranceId, CancellationException("Speech stopped"))
            })
            fun queue(index: Int) {
                val turn = spoken[index].second
                val text = turn.text.trim()
                require(text.length in 1..minOf(2000, TextToSpeech.getMaxSpeechInputLength()))
                val chosen = if (distinguishSpeakers && turn.speaker == PodcastSpeaker.GUIDE) secondVoice else voice
                check(tts.setVoice(chosen) != TextToSpeech.ERROR) { "Offline voice is unavailable." }
                val utteranceId = id(index)
                pending[utteranceId] = Pending()
                val file = renderDirectory?.let { java.io.File(it, "part-$index.wav") }
                val result = if (file == null)
                    tts.speak(text, TextToSpeech.QUEUE_ADD, null, utteranceId)
                else tts.synthesizeToFile(text, android.os.Bundle(), file, utteranceId)
                check(result != TextToSpeech.ERROR) { "Android offline voice refused the audio request." }
            }
            // Only one upcoming utterance queued: bounded lookahead, no full audio render.
            queue(0)
            spoken.forEachIndexed { index, entry ->
                val turn = entry.second
                currentCoroutineContext().ensureActive()
                val item = checkNotNull(pending[id(index)])
                if (renderDirectory == null && index + 1 < spoken.size) queue(index + 1)
                val timeout = (30_000L + turn.text.length * 150L).coerceAtMost(360_000L)
                withTimeout(timeout) {
                    item.started.await()
                    onSpeaker(entry.first)
                    onStage((if (renderDirectory == null) "Playing " else "Preparing audio ") + "${index + 1} of ${spoken.size}")
                    item.done.await()
                }
                pending.remove(id(index))
                if (renderDirectory != null) {
                    val destination = java.io.File(renderDirectory, "part-$index.wav")
                    withContext(Dispatchers.IO) {
                        check(destination.length() > 44L) { "Android voice did not produce playable audio." }
                        check(renderDirectory.listFiles().orEmpty().sumOf { it.length() } <= 128L * 1024 * 1024)
                    }
                    if (index + 1 < spoken.size) queue(index + 1)
                }
            }
        } catch (timeout: TimeoutCancellationException) {
            failed = true
            throw IllegalStateException("Android offline speech timed out.", timeout)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (failure: Exception) {
            failed = true
            throw failure
        } finally {
            withContext(NonCancellable + Dispatchers.Main.immediate) {
                tts.stop()
                pending.clear()
                if (active === tts) active = null
                if (failed) closeWarmEngine()
            }
        }
    }

    suspend fun prepareReadAloud(context: Context, text: String, directory: java.io.File,
        onStage: suspend (String) -> Unit): List<java.io.File> {
        val turns = NeuralTextSegmenter.split(text, maxChunk = 1000, maxText = 12_000)
            .map { PodcastTurn(PodcastSpeaker.GUIDE, it) }
        speakDialogue(context, turns, OfflineNarrationPreferences(context).speed, {}, onStage,
            renderDirectory = directory)
        return directory.listFiles().orEmpty().filter { it.name.matches(Regex("part-[0-9]+\\.wav")) }
            .sortedBy { it.name.removePrefix("part-").removeSuffix(".wav").toInt() }
    }

    fun stop() {
        runCatching { active?.stop() }
    }
}
