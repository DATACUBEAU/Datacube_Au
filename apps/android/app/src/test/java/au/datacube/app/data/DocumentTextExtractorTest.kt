package au.datacube.app.data

import java.io.File
import java.io.RandomAccessFile
import java.nio.charset.StandardCharsets
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.assertThrows
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class DocumentTextExtractorTest {
    @get:Rule
    val temporaryFolder = TemporaryFolder()

    private val extractor = PlainTextDocumentExtractor()

    @Test
    fun stripsBomAndNormalizesAllNewlineForms() {
        val source = temporaryFolder.newFile("source.txt")
        val destination = File(temporaryFolder.root, "output.txt")
        val expected = "alpha\nbeta\ngamma\n"
        source.writeText("\uFEFFalpha\r\nbeta\rgamma\n", StandardCharsets.UTF_8)

        val result = extract(source, destination)

        assertEquals(expected, destination.readText(StandardCharsets.UTF_8))
        assertEquals(expected.toByteArray(StandardCharsets.UTF_8).size.toLong(), result.bytesWritten)
        assertEquals(expected.length.toLong(), result.charactersWritten)
    }

    @Test
    fun preservesUnicodeTextAndCountsUtf8Bytes() {
        val source = temporaryFolder.newFile("unicode.md")
        val destination = File(temporaryFolder.root, "output.txt")
        val expected = "DataCube 世界 🌍\n"
        source.writeText(expected, StandardCharsets.UTF_8)

        val result = extract(source, destination)

        assertEquals(expected, destination.readText(StandardCharsets.UTF_8))
        assertEquals(expected.toByteArray(StandardCharsets.UTF_8).size.toLong(), result.bytesWritten)
        assertEquals(expected.length.toLong(), result.charactersWritten)
    }

    @Test
    fun rejectsMalformedUtf8WithoutReplacingExistingOutput() {
        val source = temporaryFolder.newFile("invalid.txt")
        val destination = File(temporaryFolder.root, "output.txt")
        source.writeBytes(byteArrayOf(0xC3.toByte(), 0x28))
        destination.writeText("previous result", StandardCharsets.UTF_8)

        assertThrows(TextExtractionRejectedException::class.java) {
            extract(source, destination)
        }

        assertEquals("previous result", destination.readText(StandardCharsets.UTF_8))
        assertFalse(File(destination.parentFile, destination.name + ".tmp").exists())
    }

    @Test
    fun rejectsBinaryNullBytesWithoutPublishingPartialOutput() {
        val source = temporaryFolder.newFile("binary.txt")
        val destination = File(temporaryFolder.root, "output.txt")
        source.writeText("before\u0000after", StandardCharsets.UTF_8)
        destination.writeText("previous result", StandardCharsets.UTF_8)

        assertThrows(TextExtractionRejectedException::class.java) {
            extract(source, destination)
        }

        assertEquals("previous result", destination.readText(StandardCharsets.UTF_8))
        assertFalse(File(destination.parentFile, destination.name + ".tmp").exists())
    }

    @Test
    fun rejectsFilesAboveTheOnDeviceLimitBeforeWriting() {
        val source = temporaryFolder.newFile("large.txt")
        val destination = File(temporaryFolder.root, "output.txt")
        RandomAccessFile(source, "rw").use { it.setLength(20L * 1024L * 1024L + 1L) }
        destination.writeText("previous result", StandardCharsets.UTF_8)

        assertThrows(TextExtractionRejectedException::class.java) {
            extract(source, destination)
        }

        assertEquals("previous result", destination.readText(StandardCharsets.UTF_8))
    }

    @Test
    fun reportsMonotonicBoundedProgressForLargeText() {
        val source = temporaryFolder.newFile("large.md")
        val destination = File(temporaryFolder.root, "output.txt")
        source.writeText("x".repeat(600 * 1024), StandardCharsets.UTF_8)
        val progress = mutableListOf<Double>()

        extract(source, destination) { progress += it }

        assertTrue(progress.isNotEmpty())
        assertEquals(progress.sorted(), progress)
        assertTrue(progress.all { it in 0.0..0.95 })
        assertTrue(destination.isFile)
    }

    private fun extract(
        source: File,
        destination: File,
        onProgress: suspend (Double) -> Unit = {}
    ) = runBlocking {
        extractor.extract(source, destination, onProgress)
    }
}
