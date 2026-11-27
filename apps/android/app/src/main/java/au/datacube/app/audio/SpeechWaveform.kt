package au.datacube.app.audio

import java.io.File
import java.io.RandomAccessFile
import kotlin.math.abs

/** Bounded, real PCM16 samples from cached audio. Unsupported formats use the
 * ordinary seek slider instead of displaying a fabricated waveform. */
internal object SpeechWaveform {
    private data class Region(val offset: Long, val length: Long, val frameBytes: Int)
    private fun four(input: RandomAccessFile): String {
        val bytes = ByteArray(4)
        input.readFully(bytes)
        return String(bytes, Charsets.US_ASCII)
    }
    private fun uint(input: RandomAccessFile): Long = Integer.reverseBytes(input.readInt()).toLong() and 0xffffffffL
    private fun ushort(input: RandomAccessFile): Int = java.lang.Short.reverseBytes(input.readShort()).toInt() and 0xffff
    private fun region(input: RandomAccessFile): Region? {
        if (input.length() < 44 || four(input) != "RIFF") return null
        uint(input)
        if (four(input) != "WAVE") return null
        var frameBytes = 0
        repeat(64) {
            if (input.filePointer + 8 > input.length()) return null
            val kind = four(input)
            val length = uint(input)
            val start = input.filePointer
            if (length > input.length() - start) return null
            if (kind == "fmt " && length >= 16) {
                val encoding = ushort(input)
                val channels = ushort(input)
                uint(input)
                uint(input)
                val align = ushort(input)
                val bits = ushort(input)
                if (encoding != 1 || channels !in 1..2 || bits != 16 || align != channels * 2) return null
                frameBytes = align
            } else if (kind == "data") {
                if (frameBytes == 0 || length < frameBytes || length % frameBytes != 0L) return null
                return Region(start, length, frameBytes)
            }
            val next = start + length + (length and 1L)
            if (next > input.length()) return null
            input.seek(next)
        }
        return null
    }

    fun sample(parts: List<Pair<File, Long>>, bins: Int = 48): List<Float> {
        require(bins in 8..96)
        if (parts.isEmpty() || parts.size > 64 || parts.any { it.second <= 0L }) return emptyList()
        val duration = parts.sumOf { it.second }
        if (duration <= 0L) return emptyList()
        val result = FloatArray(bins)
        var elapsed = 0L
        try {
            for ((file, time) in parts) {
                RandomAccessFile(file, "r").use { input ->
                    val region = region(input) ?: return emptyList()
                    val frames = region.length / region.frameBytes
                    for (bin in 0 until bins) {
                        val from = maxOf(elapsed.toDouble(), duration.toDouble() * bin / bins)
                        val to = minOf((elapsed + time).toDouble(), duration.toDouble() * (bin + 1) / bins)
                        if (to <= from) continue
                        val first = (((from - elapsed) / time) * frames).toLong().coerceIn(0L, frames - 1)
                        val last = (((to - elapsed) / time) * frames).toLong().coerceIn(first + 1, frames)
                        var peak = 0
                        // Sample short spans at fixed intervals: never decode the full audio.
                        repeat(32) { sample ->
                            val frame = first + ((last - first - 1) * sample / 31)
                            input.seek(region.offset + frame * region.frameBytes)
                            repeat(region.frameBytes / 2) {
                                peak = maxOf(peak, abs(java.lang.Short.reverseBytes(input.readShort()).toInt()))
                            }
                        }
                        result[bin] = maxOf(result[bin], peak / 32768f)
                    }
                }
                elapsed += time
            }
        } catch (_: Exception) { return emptyList() }
        val maximum = result.maxOrNull() ?: 0f
        if (maximum <= 0f) return result.toList()
        return result.map { (it / maximum).coerceIn(0f, 1f) }
    }
}
