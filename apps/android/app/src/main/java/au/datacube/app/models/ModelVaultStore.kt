package au.datacube.app.models

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** User-selected external folder that survives app uninstall. Re-selection is required after reinstall. */
class ModelVaultStore(context: Context) {
    private val app = context.applicationContext
    private val prefs = app.getSharedPreferences("datacube_model_vault", Context.MODE_PRIVATE)
    private val resolver get() = app.contentResolver

    data class Archive(val uri: Uri, val filename: String, val preview: ModelBackupPreview)

    fun folder(): Uri? {
        val uri = prefs.getString(KEY_FOLDER, null)?.let(Uri::parse) ?: return null
        return uri.takeIf { saved ->
            resolver.persistedUriPermissions.any {
                it.uri == saved && it.isReadPermission && it.isWritePermission
            }
        }
    }

    fun selectFolder(uri: Uri) {
        require(uri.scheme == "content") { "Choose a folder through Android's file picker." }
        resolver.takePersistableUriPermission(
            uri,
            Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
        )
        check(prefs.edit().putString(KEY_FOLDER, uri.toString()).commit()) {
            "Could not save model folder selection."
        }
    }

    /** Inspect archive headers to identify model IDs and roles without importing the weights. */
    suspend fun archives(): List<Archive> = withContext(Dispatchers.IO) {
        val manager = ModelBackupManager(app)
        entries().filter { it.first.endsWith(".zip", ignoreCase = true) }
            .take(MAX_ARCHIVES)
            .mapNotNull { (name, uri) ->
                runCatching { Archive(uri, name, manager.inspectBackup(uri)) }.getOrNull()
            }
    }

    /**
     * Writes to a .partial document; only verified, fully finished backups are renamed .zip.
     * The archive includes the model ID, path, file sizes and SHA-256 hashes.
     */
    suspend fun save(modelId: String): ModelBackupSummary = withContext(Dispatchers.IO) {
        check(ModelCatalog.models.any { it.id == modelId }) { "Unknown model type." }
        val dir = requireNotNull(folder()) { "Select your model folder first." }
        // Abandoned copies from an interrupted earlier backup cannot be mistaken for archives.
        entries().filter { (name, _) ->
            name.startsWith("DataCubeAU-$modelId-") && name.endsWith(".partial")
        }.forEach { (_, uri) ->
            runCatching { DocumentsContract.deleteDocument(resolver, uri) }
        }
        val id = DocumentsContract.getTreeDocumentId(dir)
        val parent = DocumentsContract.buildDocumentUriUsingTree(dir, id)
        val partialName = ModelBackupManager.suggestedName(modelId).removeSuffix(".zip") + ".partial"
        val destination = DocumentsContract.createDocument(
            resolver, parent, "application/octet-stream", partialName
        ) ?: error("This folder cannot create a model archive.")
        try {
            val summary = ModelBackupManager(app).exportBackup(destination, modelId)
            val finalName = partialName.removeSuffix(".partial") + ".zip"
            check(DocumentsContract.renameDocument(resolver, destination, finalName) != null) {
                "The storage provider could not finish the archive."
            }
            summary
        } catch (error: Exception) {
            runCatching { DocumentsContract.deleteDocument(resolver, destination) }
            throw error
        }
    }

    suspend fun restore(uri: Uri): ModelBackupSummary = withContext(Dispatchers.IO) {
        // ZIP header and internal path checks, hashes, duplicates and atomic install
        // are checked by ModelBackupManager.restoreBackup.
        ModelBackupManager(app).restoreBackup(uri)
    }

    private fun entries(): List<Pair<String, Uri>> {
        val tree = requireNotNull(folder()) { "Choose your model folder again." }
        val parentId = DocumentsContract.getTreeDocumentId(tree)
        val children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parentId)
        val fields = arrayOf(
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE
        )
        val result = mutableListOf<Pair<String, Uri>>()
        resolver.query(children, fields, null, null, null)?.use { cursor ->
            while (cursor.moveToNext() && result.size < MAX_ARCHIVES * 4) {
                val id = cursor.getString(0) ?: continue
                val name = cursor.getString(1) ?: continue
                val mime = cursor.getString(2)
                if (name.startsWith("DataCubeAU-") &&
                    (mime == ModelBackupManager.BACKUP_MIME_TYPE || mime == "application/octet-stream")
                ) {
                    result += name to DocumentsContract.buildDocumentUriUsingTree(tree, id)
                }
            }
        }
        return result
    }

    companion object {
        private const val KEY_FOLDER = "folder"
        private const val MAX_ARCHIVES = 64
    }
}
