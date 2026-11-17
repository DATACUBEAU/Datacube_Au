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
import kotlinx.coroutines.CancellationException
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

    fun delete(id: String) {
        viewModelScope.launch {
            repository.delete(id)
        }
    }
}
