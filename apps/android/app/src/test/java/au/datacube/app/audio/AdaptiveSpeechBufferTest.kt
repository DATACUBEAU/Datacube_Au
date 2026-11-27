package au.datacube.app.audio

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.assertEquals
import org.junit.Test

class AdaptiveSpeechBufferTest {
    @Test fun fastDeviceCanStartBeforeComplete() {
        assertTrue(AdaptiveSpeechBuffer.canStart(15.0, 5.0, 150, 1000, 1f, false))
    }
    @Test fun borderlineDeviceRequiresEnoughLeadForRemainingAudio() {
        assertFalse(AdaptiveSpeechBuffer.canStart(8.0, 8.0, 100, 1000, 1f, false))
        assertTrue(AdaptiveSpeechBuffer.canStart(35.0, 35.0, 700, 1000, 1f, false))
    }
    @Test fun slowDeviceWaitsForCompleteAndShortAudioStillPlays() {
        assertFalse(AdaptiveSpeechBuffer.canStart(30.0, 60.0, 500, 1000, 1f, false))
        assertTrue(AdaptiveSpeechBuffer.canStart(30.0, 60.0, 1000, 1000, 1f, true))
        assertTrue(AdaptiveSpeechBuffer.canStart(1.0, 3.0, 10, 10, 1f, true))
    }
    @Test fun fasterPlaybackNeedsMoreLead() {
        assertTrue(AdaptiveSpeechBuffer.canStart(12.0, 8.0, 150, 1000, 1f, false))
        assertFalse(AdaptiveSpeechBuffer.canStart(12.0, 8.0, 150, 1000, 1.5f, false))
        assertEquals(144000L, AdaptiveSpeechBuffer.refillSamples(24000, 1.5f))
    }
    @Test fun invalidMeasurementsNeverTriggerEarlyPlayback() {
        assertFalse(AdaptiveSpeechBuffer.canStart(0.0, 0.0, 0, 1000, 1f, false))
        assertFalse(AdaptiveSpeechBuffer.canStart(10.0, Double.NaN, 100, 1000, 1f, false))
    }
}
