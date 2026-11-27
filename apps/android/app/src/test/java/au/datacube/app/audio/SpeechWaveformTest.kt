package au.datacube.app.audio

import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class SpeechWaveformTest {
    @get:Rule val folder = TemporaryFolder()

    @Test fun samplesRealQuietAndLoudPcmAndRejectsInvalidAudio() {
        val frames = 4800
        val buffer = ByteBuffer.allocate(44 + frames * 2).order(ByteOrder.LITTLE_ENDIAN)
        buffer.put("RIFF".toByteArray()).putInt(36 + frames * 2)
        buffer.put("WAVEfmt ".toByteArray()).putInt(16)
        buffer.putShort(1.toShort()).putShort(1.toShort()).putInt(16000).putInt(32000)
        buffer.putShort(2.toShort()).putShort(16.toShort())
        buffer.put("data".toByteArray()).putInt(frames * 2)
        repeat(frames) { buffer.putShort((if (it < frames / 2) 500 else 20000).toShort()) }
        val wav = folder.newFile("speech.wav").apply { writeBytes(buffer.array()) }
        val levels = SpeechWaveform.sample(listOf(wav to 300L), 16)
        assertEquals(16, levels.size)
        assertTrue(levels.take(8).all { it < 0.1f })
        assertTrue(levels.takeLast(8).all { it > 0.9f })
        val invalid = folder.newFile("bad.wav").apply { writeText("not audio") }
        assertTrue(SpeechWaveform.sample(listOf(invalid to 300L)).isEmpty())
    }
}
