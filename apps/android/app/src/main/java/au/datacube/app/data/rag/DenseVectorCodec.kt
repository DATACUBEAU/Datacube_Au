package au.datacube.app.data.rag

import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.sqrt

object DenseVectorCodec {
    fun encode(source: FloatArray): ByteArray {
        require(source.isNotEmpty() && source.size <= 4096) { "Invalid embedding dimension." }
        require(source.all { it.isFinite() }) { "Non-finite embedding values." }
        val buffer = ByteBuffer.allocate(source.size * 4).order(ByteOrder.LITTLE_ENDIAN)
        source.forEach { buffer.putFloat(it) }
        return buffer.array()
    }

    fun decode(bytes: ByteArray, dimension: Int): FloatArray {
        require(dimension in 1..4096 && bytes.size == dimension * 4) { "Corrupt embedding bytes." }
        val buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
        return FloatArray(dimension) { buffer.float }.also {
            require(it.all(Float::isFinite)) { "Non-finite stored embedding." }
        }
    }

    fun cosine(first: FloatArray, second: FloatArray): Double {
        require(first.isNotEmpty() && first.size == second.size) { "Mismatched embedding sizes." }
        var dot = 0.0
        var normFirst = 0.0
        var normSecond = 0.0
        first.indices.forEach { i ->
            val a = first[i].toDouble()
            val b = second[i].toDouble()
            require(a.isFinite() && b.isFinite())
            dot += a * b
            normFirst += a * a
            normSecond += b * b
        }
        if (normFirst == 0.0 || normSecond == 0.0) return 0.0
        return (dot / sqrt(normFirst * normSecond)).coerceIn(-1.0, 1.0)
    }
}
