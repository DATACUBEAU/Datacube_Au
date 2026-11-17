package au.datacube.app.data

import android.content.ContentResolver
import android.net.Uri
import android.webkit.MimeTypeMap
import androidx.room.withTransaction
import java.io.File
import java.util.UUID
import org.json.JSONObject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.withContext

data class ImportedDocument(
    val document: LocalDocument,
    val jobId: String
)

class LocalDocumentRepository(
    private val database: DataCubeDatabase,
    private val filesDir: File
) {
    val documents: Flow<List<LocalDocument>> = database.documents().observeAll()

    suspend fun import(
        uri: Uri,
        resolver: ContentResolver,
        name: String
    ): ImportedDocument = withContext(Dispatchers.IO) {
        val extension = name.substringAfterLast('.', "").lowercase()
        require(extension in SUPPORTED_EXTENSIONS) {
            "Choose a PDF, DOCX, TXT, RTF or Markdown file."
        }

        val id = UUID.randomUUID().toString()
        val jobId = UUID.randomUUID().toString()
        val folder = File(filesDir, "documents").apply { mkdirs() }
        val target = File(folder, id + "." + extension)

        try {
            val input = resolver.openInputStream(uri)
                ?: error("The selected file could not be read.")
            input.use { source ->
                target.outputStream().use { output ->
                    val buffer = ByteArray(8192)
                    var total = 0L
                    while (true) {
                        val count = source.read(buffer)
                        if (count < 0) break
                        total += count
                        require(total <= MAX_DOCUMENT_BYTES) {
                            "Files must be 100 MB or smaller."
                        }
                        output.write(buffer, 0, count)
                    }
                    require(total > 0L) { "The selected file is empty." }
                }
            }

            val mimeType = resolver.getType(uri)
                ?: MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension)
                ?: "application/octet-stream"
            val now = System.currentTimeMillis()
            val document = LocalDocument(
                id = id,
                name = name,
                extension = extension,
                mimeType = mimeType,
                sizeBytes = target.length(),
                privatePath = target.absolutePath,
                createdAtEpochMs = now
            )
            // The document receipt and its durable job are committed together.
            // WorkManager is scheduled only after this transaction succeeds.
            val job = LocalJob(
                id = jobId,
                kind = LocalJobKind.DOCUMENT_INTEGRITY_CHECK,
                status = LocalJobStatus.QUEUED,
                payloadJson = JSONObject().put("documentId", id).toString(),
                progress = 0.0,
                attempts = 0,
                createdAtEpochMs = now,
                updatedAtEpochMs = now
            )
            database.withTransaction {
                database.documents().insert(document)
                database.jobs().insert(job)
            }
            ImportedDocument(document, jobId)
        } catch (error: Throwable) {
            target.delete()
            throw error
        }
    }

    suspend fun delete(id: String) = withContext(Dispatchers.IO) {
        database.documents().find(id)?.let { document ->
            database.documents().delete(id)
            File(document.privatePath).delete()
        }
    }

    companion object {
        private const val MAX_DOCUMENT_BYTES = 100L * 1024L * 1024L
        private val SUPPORTED_EXTENSIONS = setOf("pdf", "docx", "txt", "rtf", "md")
    }
}
