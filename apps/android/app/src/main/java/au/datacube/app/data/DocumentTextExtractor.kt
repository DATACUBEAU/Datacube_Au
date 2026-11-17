package au.datacube.app.data

import java.io.BufferedReader
import java.io.BufferedWriter
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.io.IOException
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext

data class ExtractedDocumentText(
    val bytesWritten: Long,
    val charactersWritten: Long
)

interface DocumentTextExtractor {
    suspend fun extract(
        source: File,
        destination: File,
        onProgress: suspend (Double) -> Unit
    ): ExtractedDocumentText
}

class PlainTextDocumentExtractor : DocumentTextExtractor {
    override suspend fun extract(
        source: File,
        destination: File,
        onProgress: suspend (Double) -> Unit
    ): ExtractedDocumentText = withContext(Dispatchers.IO) {
        if (!source.isFile || source.length() <= 0L) {
            throw TextExtractionRejectedException("The private document file is unavailable.")
        }
        if (source.length() > MAX_SOURCE_BYTES) {
            throw TextExtractionRejectedException(
                "Text files larger than 20 MB are not extracted on this device."
            )
        }

        val parent = destination.parentFile
        if (parent != null && !parent.exists() && !parent.mkdirs()) {
            throw IOException("Could not create the private extraction directory.")
        }
        val temporary = File(destination.parentFile, destination.name + ".tmp")
        temporary.delete()

        try {
            val decoder = StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
            var charactersWritten = 0L
            var charactersRead = 0L
            var lastProgressAt = 0L

            BufferedReader(InputStreamReader(FileInputStream(source), decoder)).use { reader ->
                BufferedWriter(
                    OutputStreamWriter(FileOutputStream(temporary), StandardCharsets.UTF_8)
                ).use { writer ->
                    val buffer = CharArray(BUFFER_SIZE)
                    var firstCharacter = true
                    var pendingCarriageReturn = false

                    fun writeCharacter(character: Char) {
                        writer.write(character.code)
                        charactersWritten += 1
                    }

                    while (true) {
                        currentCoroutineContext().ensureActive()
                        val count = reader.read(buffer)
                        if (count < 0) break
                        charactersRead += count

                        for (index in 0 until count) {
                            val character = buffer[index]
                            if (firstCharacter) {
                                firstCharacter = false
                                if (character == '\uFEFF') continue
                            }
                            if (character == '\u0000') {
                                throw TextExtractionRejectedException(
                                    "The selected file is not plain UTF-8 text."
                                )
                            }

                            if (pendingCarriageReturn) {
                                writeCharacter('\n')
                                pendingCarriageReturn = false
                                if (character == '\n') continue
                            }

                            if (character == '\r') {
                                pendingCarriageReturn = true
                            } else {
                                writeCharacter(character)
                            }
                        }

                        if (charactersRead - lastProgressAt >= PROGRESS_INTERVAL_CHARS) {
                            val progress = (charactersRead.toDouble() / source.length().toDouble())
                                .coerceIn(0.0, 0.95)
                            onProgress(progress)
                            lastProgressAt = charactersRead
                        }
                    }

                    if (pendingCarriageReturn) writeCharacter('\n')
                    writer.flush()
                }
            }

            if (charactersWritten == 0L) {
                throw TextExtractionRejectedException("The document contains no text.")
            }

            try {
                Files.move(
                    temporary.toPath(),
                    destination.toPath(),
                    StandardCopyOption.ATOMIC_MOVE,
                    StandardCopyOption.REPLACE_EXISTING
                )
            } catch (unsupported: AtomicMoveNotSupportedException) {
                Files.move(
                    temporary.toPath(),
                    destination.toPath(),
                    StandardCopyOption.REPLACE_EXISTING
                )
            }

            ExtractedDocumentText(
                bytesWritten = destination.length(),
                charactersWritten = charactersWritten
            )
        } catch (error: CharacterCodingException) {
            throw TextExtractionRejectedException(
                "The selected file is not valid UTF-8 text."
            )
        } finally {
            temporary.delete()
        }
    }

    companion object {
        private const val MAX_SOURCE_BYTES = 20L * 1024L * 1024L
        private const val BUFFER_SIZE = 8192
        private const val PROGRESS_INTERVAL_CHARS = 512L * 1024L
    }
}

class TextExtractionRejectedException(message: String) : Exception(message)

object ExtractedTextStore {
    fun fileFor(filesDir: File, documentId: String): File =
        File(File(filesDir, "extracted"), "$documentId.txt")
}
