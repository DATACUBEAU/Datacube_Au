package au.datacube.app.ui.voice

import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class WavePcmTest {
    @Test fun wavHeaderIncludesCorrectMonoPcmRateAndLength() {
        val samples = 16_000 * 2 * 2 // Two seconds of mono 16 kHz PCM16
        val header = WavePcm.header(samples)
        assertEquals(44, header.size)
        assertEquals("RIFF", String(header.copyOfRange(0, 4)))
        assertEquals("WAVE", String(header.copyOfRange(8, 12)))
        assertEquals("fmt ", String(header.copyOfRange(12, 16)))
        assertEquals("data", String(header.copyOfRange(36, 40)))
        val data = ByteBuffer.wrap(header).order(ByteOrder.LITTLE_ENDIAN)
        assertEquals(36 + samples, data.getInt(4))
        assertEquals(1, data.getShort(20).toInt()) // PCM format
        assertEquals(1, data.getShort(22).toInt()) // mono
        assertEquals(16_000, data.getInt(24))
        assertEquals(32_000, data.getInt(28))
        assertEquals(16, data.getShort(34).toInt()) // 16-bit
        assertEquals(samples, data.getInt(40))
    }

    @Test fun rejectsAudioLargerThanConsentBound() {
        assertThrows(IllegalArgumentException::class.java) {
            WavePcm.header(WavePcm.MAX_AUDIO_BYTES + 1)
        }
    }
}
