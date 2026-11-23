package au.datacube.app.data.rag

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class DenseVectorCodecTest {
    @Test fun roundTripPreservesFloats() {
        val vector = floatArrayOf(0.4f, -0.2f, 0.8f, 0f)
        val encoded = DenseVectorCodec.encode(vector)
        assertEquals(vector.size * 4, encoded.size)
        val decoded = DenseVectorCodec.decode(encoded, vector.size)
        assertTrue(decoded.contentEquals(vector))
    }

    @Test fun cosineRanksIdenticalAboveOrthogonal() {
        val a = floatArrayOf(0.25f, 0.75f)
        val b = floatArrayOf(0.75f, -0.25f)
        assertEquals(1.0, DenseVectorCodec.cosine(a, a), 0.000001)
        assertEquals(0.0, DenseVectorCodec.cosine(a, b), 0.000001)
    }

    @Test fun refusesMalformedOrNonFiniteData() {
        assertThrows(IllegalArgumentException::class.java) {
            DenseVectorCodec.encode(floatArrayOf(Float.NaN, 0f))
        }
        assertThrows(IllegalArgumentException::class.java) {
            DenseVectorCodec.decode(byteArrayOf(0, 0), 2)
        }
        assertThrows(IllegalArgumentException::class.java) {
            DenseVectorCodec.cosine(floatArrayOf(1f), floatArrayOf(1f, 2f))
        }
    }
}
