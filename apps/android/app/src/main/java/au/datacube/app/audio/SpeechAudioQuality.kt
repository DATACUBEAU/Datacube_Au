package au.datacube.app.audio

import kotlin.math.abs

/** Sanity checks only. Signal metrics cannot prove lexical accuracy. */
internal class SpeechAudioQuality(private val rate: Int) {
    var samples: Long = 0
        private set
    private var audibleSamples = 0L
    private var trailingQuiet = 0L
    private var peak = 0f
    private var finite = true

    fun observe(sample: Float) {
        samples++
        if (!sample.isFinite()) { finite = false; return }
        val magnitude = abs(sample)
        peak = maxOf(peak, magnitude)
        if (magnitude >= 0.003f) {
            audibleSamples++
            trailingQuiet = 0
        } else trailingQuiet++
    }

    fun acceptable(text: String): Boolean {
        // Deliberately conservative: catch empty/near-silent or grossly short
        // results, not ordinary accents, brief consonants or speaking styles.
        val words = Regex("[\\p{L}\\p{N}]+").findAll(text).count()
        val minimumMs = maxOf(50L, words * 45L)
        return finite && samples * 1000 / rate >= minimumMs &&
            peak >= 0.005f && audibleSamples >= rate / 100
    }

    fun additionalSilenceSamples(targetMs: Int): Int =
        (rate.toLong() * targetMs.coerceIn(0, 650) / 1000 - trailingQuiet)
            .coerceAtLeast(0).toInt()
}
