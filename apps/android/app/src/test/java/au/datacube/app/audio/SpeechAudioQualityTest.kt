package au.datacube.app.audio

import org.junit.Assert.*
import org.junit.Test

class SpeechAudioQualityTest {
    @Test fun rejectsSilentNonFiniteAndGrosslyShortAudio() {
        val silent = SpeechAudioQuality(24000)
        repeat(24000) { silent.observe(0f) }
        assertFalse(silent.acceptable("He chose to be a guy."))
        val short = SpeechAudioQuality(24000)
        repeat(2400) { short.observe(0.12f) }
        assertFalse(short.acceptable("He chose to be a guy."))
        val broken = SpeechAudioQuality(24000)
        repeat(24000) { broken.observe(0.12f) }
        broken.observe(Float.NaN)
        assertFalse(broken.acceptable("He chose."))
    }

    @Test fun countsExistingQuietAndDoesNotAddUnnecessaryPauses() {
        val quality = SpeechAudioQuality(24000)
        repeat(24000) { quality.observe(0.12f) }
        repeat(2400) { quality.observe(0f) }
        assertTrue(quality.acceptable("He chose to be a guy."))
        assertEquals(3840, quality.additionalSilenceSamples(260))
        assertEquals(0, quality.additionalSilenceSamples(0))
        repeat(9600) { quality.observe(0f) }
        assertEquals(0, quality.additionalSilenceSamples(420))
        assertEquals(36000L, quality.samples)
    }
}
