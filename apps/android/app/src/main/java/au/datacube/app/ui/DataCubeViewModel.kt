package au.datacube.app.ui

import android.app.Application
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import au.datacube.app.DataCubeApp
import au.datacube.app.notifications.LocalNotificationService
import au.datacube.app.ui.documents.DocumentChatSessions
import au.datacube.app.data.DataCubeDatabase
import au.datacube.app.data.LocalDocumentProcessing
import au.datacube.app.data.ExtractedTextStore
import au.datacube.app.work.LocalJobScheduler
import au.datacube.app.data.LocalDocumentRepository
import au.datacube.app.data.LocalCollection
import au.datacube.app.data.LocalCollectionDocument
import au.datacube.app.data.LocalCollectionWithCount
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow
import au.datacube.app.data.LocalDocument
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.emitAll
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

data class LocalDocumentTextPreview(val text: String, val truncated: Boolean)

class DataCubeViewModel(app: Application) : AndroidViewModel(app) {
    private companion object {
        const val MAX_DOCUMENT_PREVIEW_CHARS = 48_000
    }
    private val database: DataCubeDatabase get() = getApplication<DataCubeApp>().database
    private val repository by lazy { LocalDocumentRepository(database, app.filesDir) }
    private val jobScheduler by lazy { LocalJobScheduler(app) }

    val documents: StateFlow<List<LocalDocumentProcessing>> =
        flow { emitAll(database.documents().observeAllWithProcessing()) }.flowOn(Dispatchers.IO).stateIn(
            viewModelScope,
            SharingStarted.WhileSubscribed(5_000),
            emptyList()
        )

    fun import(uri: Uri, name: String, done: (Result<Unit>) -> Unit) {
        viewModelScope.launch {
            try {
                val imported = repository.import(
                    uri,
                    getApplication<Application>().contentResolver,
                    name
                )
                imported.jobs.forEach { job -> jobScheduler.enqueue(job.id, job.kind) }
                done(Result.success(Unit))
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Exception) {
                done(Result.failure(error))
            }
        }
    }

    /**
     * Imports a user-selected batch sequentially. Each file is durably copied and
     * registered before the next one starts, keeping memory and IO pressure bounded.
     */
    fun importMany(uris: List<Uri>, done: (Result<Int>) -> Unit) {
        if (uris.isEmpty()) {
            done(Result.success(0))
            return
        }
        viewModelScope.launch {
            var importedCount = 0
            try {
                val resolver = getApplication<Application>().contentResolver
                for (uri in uris) {
                    val displayName = withContext(Dispatchers.IO) {
                        resolver.query(
                            uri,
                            arrayOf(android.provider.OpenableColumns.DISPLAY_NAME),
                            null,
                            null,
                            null
                        )?.use { cursor ->
                            if (cursor.moveToFirst()) cursor.getString(0) else null
                        } ?: "Imported document"
                    }
                    val imported = repository.import(uri, resolver, displayName)
                    imported.jobs.forEach { job -> jobScheduler.enqueue(job.id, job.kind) }
                    importedCount += 1
                }
                done(Result.success(importedCount))
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Exception) {
                val reason = error.message ?: "Import failed."
                done(Result.failure(IllegalStateException(
                    "Imported " + importedCount + " of " + uris.size + " files. " + reason,
                    error
                )))
            }
        }
    }

    val collections: StateFlow<List<LocalCollectionWithCount>> =
        flow { emitAll(database.collections().observeAllWithCount()) }.flowOn(Dispatchers.IO).stateIn(
            viewModelScope,
            SharingStarted.WhileSubscribed(5_000),
            emptyList()
        )

    fun createCollection(name: String, description: String = "", done: (Result<String>) -> Unit) {
        viewModelScope.launch {
            try {
                val cleanName = name.trim()
                require(cleanName.isNotEmpty()) { "Enter a collection name." }
                require(cleanName.length <= 60) { "Collection names can contain up to 60 characters." }
                val now = System.currentTimeMillis()
                val id = UUID.randomUUID().toString()
                database.collections().insert(
                    LocalCollection(id, cleanName, description.trim(), now, now)
                )
                done(Result.success(id))
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Exception) {
                done(Result.failure(error))
            }
        }
    }

    fun observeCollectionDocuments(collectionId: String): Flow<List<LocalDocument>> =
        database.collections().observeDocuments(collectionId)

    fun addDocumentsToCollection(collectionId: String, documentIds: List<String>) {
        if (documentIds.isEmpty()) return
        viewModelScope.launch {
            val now = System.currentTimeMillis()
            database.collections().addDocuments(
                documentIds.distinct().map { LocalCollectionDocument(collectionId, it, now) }
            )
        }
    }

    fun removeDocumentFromCollection(collectionId: String, documentId: String) {
        viewModelScope.launch {
            database.collections().removeDocument(collectionId, documentId)
        }
    }

    fun deleteCollection(id: String) {
        viewModelScope.launch { database.collections().delete(id) }
    }

    fun importManyToCollection(
        uris: List<Uri>,
        collectionId: String,
        done: (Result<Int>) -> Unit
    ) {
        if (uris.isEmpty()) {
            done(Result.success(0))
            return
        }
        viewModelScope.launch {
            var importedCount = 0
            try {
                // Copy and enqueue sequentially: large batches never fan out dozens
                // of simultaneous file streams or database writes on the UI thread.
                for (uri in uris) {
                    val displayName = withContext(Dispatchers.IO) {
                        getApplication<Application>().contentResolver
                            .query(
                                uri,
                                arrayOf(android.provider.OpenableColumns.DISPLAY_NAME),
                                null,
                                null,
                                null
                            )
                            ?.use { cursor ->
                                if (cursor.moveToFirst()) cursor.getString(0) else null
                            } ?: "Imported document"
                    }
                    val imported = repository.import(
                        uri,
                        getApplication<Application>().contentResolver,
                        displayName
                    )
                    database.collections().addDocuments(
                        listOf(LocalCollectionDocument(collectionId, imported.document.id, System.currentTimeMillis()))
                    )
                    imported.jobs.forEach { job -> jobScheduler.enqueue(job.id, job.kind) }
                    importedCount += 1
                }
                done(Result.success(importedCount))
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Exception) {
                done(Result.failure(IllegalStateException("Imported $importedCount of ${uris.size} files. ${error.message ?: "Import failed."}", error)))
            }
        }
    }

    /**
     * Reads only the device-private extracted text for an existing local document.
     * The preview is bounded so a large PDF cannot flood Compose memory, and this
     * content is never uploaded or sent to a cloud service by this method.
     */
    suspend fun loadDocumentTextPreview(documentId: String): LocalDocumentTextPreview? =
        withContext(Dispatchers.IO) {
            val document = database.documents().find(documentId) ?: return@withContext null
            val textFile = ExtractedTextStore.fileFor(getApplication<Application>().filesDir, document.id)
            if (!textFile.isFile) return@withContext null

            val preview = StringBuilder(MAX_DOCUMENT_PREVIEW_CHARS)
            var truncated = false
            textFile.bufferedReader(Charsets.UTF_8).use { reader ->
                val buffer = CharArray(4096)
                while (preview.length < MAX_DOCUMENT_PREVIEW_CHARS) {
                    val remaining = MAX_DOCUMENT_PREVIEW_CHARS - preview.length
                    val count = reader.read(buffer, 0, minOf(buffer.size, remaining))
                    if (count < 0) break
                    preview.append(buffer, 0, count)
                }
                if (preview.length >= MAX_DOCUMENT_PREVIEW_CHARS) {
                    truncated = reader.read() != -1
                }
            }
            LocalDocumentTextPreview(preview.toString(), truncated)
        }

    fun delete(id: String) {
        DocumentChatSessions.forgetDocument(id)
        DocumentChatSessions.forgetGlobal()
        viewModelScope.launch {
            val jobs = database.jobs().findForDocument(id)
            jobs.forEach { job ->
                jobScheduler.cancel(job.id)
                database.jobs().markCancelled(job.id, System.currentTimeMillis())
            }
            repository.delete(id)
            LocalNotificationService(getApplication())
                .cancelDocument(id, jobs.map { it.id })
        }
    }
}
