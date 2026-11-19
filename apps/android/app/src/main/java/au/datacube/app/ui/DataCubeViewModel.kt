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

    fun importToCollection(uri: Uri, name: String, collectionId: String, done: (Result<Unit>) -> Unit) {
        viewModelScope.launch {
            try {
                val imported = repository.import(uri, getApplication<Application>().contentResolver, name)
                database.collections().addDocuments(
                    listOf(LocalCollectionDocument(collectionId, imported.document.id, System.currentTimeMillis()))
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

    fun delete(id: String) {
        viewModelScope.launch {
            repository.delete(id)
        }
    }
}
