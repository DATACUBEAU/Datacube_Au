package au.datacube.app.audio

import android.content.Context
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import java.util.Locale
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
        val ready = CompletableDeferred<Boolean>()
        val tts = withContext(Dispatchers.Main) {
            if (enginePackage == null) TextToSpeech(app) { status ->
                ready.complete(status == TextToSpeech.SUCCESS)
            } else TextToSpeech(app, { status ->
                ready.complete(status == TextToSpeech.SUCCESS)
            }, enginePackage)
        }
        active = tts
        try {
            check(withTimeout(8_000) { ready.await() }) {
                "Android's offline speech engine is not available."
            }
            val offline = tts.voices.orEmpty()
                .filter { !it.isNetworkConnectionRequired }
                .sortedWith(
                    compareByDescending<android.speech.tts.Voice> {
                        it.locale.language == Locale.getDefault().language
                    }.thenBy { it.latency }.thenByDescending { it.quality }.thenBy { it.name }
                )
            require(offline.isNotEmpty()) {
                "No offline voice is installed. Add one in Android Text-to-speech settings."
            }
            val preference = OfflineNarrationPreferences(app)
            val voice = offline.firstOrNull { it.name == preference.voiceName } ?: offline.first()
            check(tts.setVoice(voice) != TextToSpeech.ERROR) {
                "The selected offline voice could not be initialized."
            }
            val secondVoice = offline.firstOrNull {
                it.name != voice.name && it.locale.language == voice.locale.language
            }
            tts.setSpeechRate(speed.coerceIn(0.7f, 1.4f))
            tts.setPitch(preference.pitch)
            turns.forEachIndexed { index, turn ->
                currentCoroutineContext().ensureActive()
                if (distinguishSpeakers) {
                    val chosen = if (turn.speaker == PodcastSpeaker.GUIDE) secondVoice ?: voice else voice
                    check(tts.setVoice(chosen) != TextToSpeech.ERROR) { "Offline voice is unavailable." }
                }
                onSpeaker(index)
                onStage((if (renderDirectory == null) "Playing " else "Preparing audio ") + "${index + 1} of ${turns.size}")
                // Android TTS has an utterance length limit. Podcast turns are already
                // short; reject oversized text rather than silently truncating speech.
                val text = turn.text.trim()
                require(text.length in 1..2_000) { "Podcast turn is too long to speak smoothly." }
                val done = CompletableDeferred<Unit>()
                val utteranceId = "datacube-audio-${index}"
                tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                    override fun onStart(utteranceId: String?) {}
                    override fun onDone(id: String?) { if (id == utteranceId) done.complete(Unit) }
                    @Deprecated("Overload required for older Android engines")
                    override fun onError(id: String?) {
                        if (id != utteranceId) return
                        done.completeExceptionally(IllegalStateException("Android offline speech failed."))
                    }
                    override fun onError(id: String?, errorCode: Int) {
                        if (id != utteranceId) return
                        done.completeExceptionally(
                            IllegalStateException("Android offline speech failed ($errorCode).")
                        )
                    }
                    override fun onStop(id: String?, interrupted: Boolean) {
                        if (id != utteranceId) return
                        done.completeExceptionally(CancellationException("Speech stopped"))
                    }
                })
                val destination = renderDirectory?.let { java.io.File(it, "part-${index}.wav") }
                val result = if (destination == null) tts.speak(text, TextToSpeech.QUEUE_ADD, null, utteranceId)
                    else tts.synthesizeToFile(text, android.os.Bundle(), destination, utteranceId)
                check(result != TextToSpeech.ERROR) { "Android offline voice refused the audio request." }
                // Do not stall for a minute between sentences. The app offers
                // the error to the user if a device voice engine hangs.
                withTimeout((30_000L + text.length * 150L).coerceAtMost(360_000L)) { done.await() }
                if (destination != null) withContext(Dispatchers.IO) {
                    check(destination.length() > 44L) { "Android voice did not produce playable audio." }
                    check(renderDirectory?.listFiles().orEmpty().sumOf { it.length() } <= 128L * 1024 * 1024) { "Audio is too long to prepare." }
                }
            }
        } finally {
            withContext(NonCancellable + Dispatchers.Main) {
                tts.stop()
                tts.shutdown()
                if (active === tts) active = null
            }
        }
    }

    suspend fun prepareReadAloud(context: Context, text: String, directory: java.io.File,
        onStage: suspend (String) -> Unit): List<java.io.File> {
        val turns = NeuralTextSegmenter.split(text, maxChunk = 1000, maxText = 12_000)
            .map { PodcastTurn(PodcastSpeaker.GUIDE, it) }
        speakDialogue(context, turns, OfflineNarrationPreferences(context).speed, {}, onStage,
            renderDirectory = directory)
        return turns.indices.map { java.io.File(directory, "part-$it.wav") }
    }

    fun stop() {
        runCatching { active?.stop() }
    }
}
