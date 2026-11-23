package au.datacube.app.audio

import java.io.File
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertTrue
import org.junit.Test

class PodcastSourceSamplerTest {
    @Test fun samplesEarlierAndFinalChaptersOfLargeDocument() = runBlocking {
        val source = File.createTempFile("datacube-book-", ".txt")
        try {
            source.bufferedWriter().use { out ->
                (0 until 12).forEach { chapter ->
                    val label = if (chapter == 11) "FINALCHAPTER" else "LESSON$chapter"
                    repeat(65) {
                        out.appendLine(
                            "The $label section explains practical mobile application architecture " +
                                "and shows how developers build and test reusable interface components " +
                                "for learning and production applications."
                        )
                    }
                }
            }
            val picked = PodcastSourceSampler.sample(
                sourceFile = source,
                documentId = "test-document",
                preview = "This is just the first screen's short preview."
            )
            assertTrue("Should include multiple evidence windows", picked.size >= 4)
            assertTrue("Early chapters should remain represented",
                picked.any { it.text.contains("LESSON0") })
            assertTrue("Final chapters must not be silently ignored",
                picked.any { it.text.contains("FINALCHAPTER") })
            assertTrue(picked.size <= 8)
        } finally {
            source.delete()
        }
    }

    @Test fun usesSourcePreviewWhenExtractedFileIsMissing() = runBlocking {
        val preview = "This lesson explains reusable UI components and teaches " +
            "how to build a clear application interface with multiple interactive " +
            "screens and test them for accessibility."
        val passages = PodcastSourceSampler.sample(null, "document-one", preview)
        assertTrue(passages.isNotEmpty())
    }
}
