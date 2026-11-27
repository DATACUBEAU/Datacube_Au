package au.datacube.app.audio

import kotlin.math.ceil
import kotlin.math.max

/** Estimate in seconds of generated audio, never in words alone. */
internal object AdaptiveSpeechBuffer {
    const val MIN_BUFFER_SECONDS = 4.0
    const val MAX_STREAM_RTF = 1.25
    const val SAFETY_FACTOR = 1.30

    fun canStart(generatedSeconds: Double, synthesisSeconds: Double,
        completedChars: Int, totalChars: Int, speed: Float, complete: Boolean): Boolean {
        if (complete) return generatedSeconds > 0
        if (completedChars <= 0 || totalChars <= completedChars || generatedSeconds <= 0 ||
            synthesisSeconds <= 0 || !generatedSeconds.isFinite() || !synthesisSeconds.isFinite()) return false
        val playbackSpeed = speed.coerceIn(0.7f, 1.5f).toDouble()
        val rtf = synthesisSeconds / generatedSeconds
        if (rtf * playbackSpeed > MAX_STREAM_RTF) return false
        val remainingAudio = generatedSeconds * (totalChars - completedChars) / completedChars
        val deficit = max(0.0, remainingAudio * (rtf * playbackSpeed * SAFETY_FACTOR - 1.0))
        val reserve = max(MIN_BUFFER_SECONDS * playbackSpeed, deficit + 2.0 * playbackSpeed)
        return generatedSeconds >= reserve
    }

    fun refillSamples(rate: Int, speed: Float): Long =
        ceil(rate * MIN_BUFFER_SECONDS * speed.coerceIn(0.7f, 1.5f)).toLong()
}
