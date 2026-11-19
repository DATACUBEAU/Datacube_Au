package au.datacube.app.ui

import android.app.Application
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import au.datacube.app.DataCubeApp
import au.datacube.app.data.DataCubeDatabase
import au.datacube.app.data.LocalDocumentProcessing
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
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class DataCubeViewModel(app: Application) : AndroidViewModel(app) {
    private val database: DataCubeDatabase = (app as DataCubeApp).database
    private val repository = LocalDocumentRepository(database, app.filesDir)
    private val jobScheduler = LocalJobScheduler(app)

    val documents: StateFlow<List<LocalDocumentProcessing>> =
        database.documents().observeAllWithProcessing().stateIn(
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

    val collections: StateFlow<List<LocalCollectionWithCount>> =
        database.collections().observeAllWithCount().stateIn(
            viewModelScope,
            SharingStarted.WhileSubscribed(5_000),
            emptyList()
        )

    fun createCollection(name: String, description: String = "", done: (Result<String>) -> Unit) {
        viewModelScope.launch {
            try {
                val cleanName = name.trim()
                require(cleanName.isNotEmpty()) { "Enter a collection name." }
                val now = System.currentTimeMillis()
                val id = UUID.randomUUID().toString()
                database.collections().insert(
                    LocalCollection(id, cleanName, description.trim(), now, now)
                )
                done(Result.success(id))
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
                    val displayName = getApplication<Application>().contentResolver
                        .query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)
                        ?.use { cursor -> if (cursor.moveToFirst()) cursor.getString(0) else null }
                        ?: "Imported document"
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

    fun delete(id: String) {
        viewModelScope.launch {
            repository.delete(id)
        }
    }
}
