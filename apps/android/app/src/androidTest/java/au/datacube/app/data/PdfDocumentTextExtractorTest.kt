package au.datacube.app.data

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.PDPage
import com.tom_roush.pdfbox.pdmodel.PDPageContentStream
import com.tom_roush.pdfbox.pdmodel.encryption.AccessPermission
import com.tom_roush.pdfbox.pdmodel.encryption.StandardProtectionPolicy
import com.tom_roush.pdfbox.pdmodel.font.PDType1Font
import java.io.File
import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.rules.TemporaryFolder

@RunWith(AndroidJUnit4::class)
class PdfDocumentTextExtractorTest {
    @get:Rule
    val temporaryFolder = TemporaryFolder()

    private val extractor = PdfDocumentTextExtractor()

    @Before
    fun initializePdfBox() {
        PDFBoxResourceLoader.init(InstrumentationRegistry.getInstrumentation().targetContext)
    }

    @Test
    fun extractsSelectableTextAndPreservesPageNumbers() {
        val source = createPdf("page one", "page two")
        val destination = File(temporaryFolder.root, "output.txt")

        val result = extract(source, destination)
        val text = destination.readText()

        assertTrue(text.contains("----- Page 1 -----\npage one"))
        assertTrue(text.contains("----- Page 2 -----\npage two"))
        assertTrue(text.indexOf("page one") < text.indexOf("page two"))
        assertEquals(text.length.toLong(), result.charactersWritten)
        assertEquals(destination.length(), result.bytesWritten)
    }

    @Test
    fun rejectsPdfWithNoSelectableTextWithoutReplacingExistingOutput() {
        val source = createPdf("")
        val destination = File(temporaryFolder.root, "output.txt")
        destination.writeText("previous result")

        val error = assertThrows(TextExtractionRejectedException::class.java) {
            extract(source, destination)
        }

        assertTrue(error.message!!.contains("no selectable text"))
        assertTrue(error.message!!.contains("OCR is not yet available"))
        assertEquals("previous result", destination.readText())
        assertFalse(File(destination.parentFile, destination.name + ".tmp").exists())
    }

    @Test
    fun rejectsMalformedPdfGracefully() {
        val source = temporaryFolder.newFile("malformed.pdf")
        source.writeText("not a PDF")
        val destination = File(temporaryFolder.root, "output.txt")

        val error = assertThrows(TextExtractionRejectedException::class.java) {
            extract(source, destination)
        }

        assertTrue(error.message!!.contains("malformed or unreadable"))
        assertFalse(destination.exists())
    }

    @Test
    fun rejectsPasswordProtectedPdfGracefully() {
        val source = createPdf("secret", passwordProtected = true)
        val destination = File(temporaryFolder.root, "output.txt")

        val error = assertThrows(TextExtractionRejectedException::class.java) {
            extract(source, destination)
        }

        assertTrue(error.message!!.contains("password-protected"))
        assertFalse(destination.exists())
    }

    @Test
    fun propagatesExtractionIoErrorsWithoutPublishingPartialOutput() {
        val source = createPdf("content")
        val blockingFile = temporaryFolder.newFile("not-a-directory")
        val destination = File(blockingFile, "output.txt")

        assertThrows(IOException::class.java) {
            extract(source, destination)
        }

        assertFalse(File(blockingFile, "output.txt.tmp").exists())
    }

    @Test
    fun cancellationLeavesExistingOutputIntactAndRemovesTemporaryFile() {
        val source = createPdf("page one", "page two")
        val destination = File(temporaryFolder.root, "output.txt")
        destination.writeText("previous result")

        assertThrows(CancellationException::class.java) {
            runBlocking {
                extractor.extract(source, destination) {
                    throw CancellationException("Test cancellation")
                }
            }
        }

        assertEquals("previous result", destination.readText())
        assertFalse(File(destination.parentFile, destination.name + ".tmp").exists())
    }

    private fun createPdf(
        vararg pageText: String,
        passwordProtected: Boolean = false
    ): File {
        val file = temporaryFolder.newFile("source.pdf")
        PDDocument().use { document ->
            pageText.forEach { text ->
                val page = PDPage()
                document.addPage(page)
                if (text.isNotEmpty()) {
                    PDPageContentStream(document, page).use { content ->
                        content.beginText()
                        content.setFont(PDType1Font.HELVETICA, 12f)
                        content.newLineAtOffset(50f, 700f)
                        content.showText(text)
                        content.endText()
                    }
                }
            }
            if (passwordProtected) {
                document.protect(
                    StandardProtectionPolicy(
                        "owner-password",
                        "user-password",
                        AccessPermission()
                    )
                )
            }
            document.save(file)
        }
        return file
    }

    private fun extract(source: File, destination: File) = runBlocking {
        extractor.extract(source, destination) {}
    }
}
