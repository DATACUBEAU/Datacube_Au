package au.datacube.app.ui
import android.app.Application
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import au.datacube.app.data.*
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
class DataCubeViewModel(app: Application) : AndroidViewModel(app) {
 private val repo = LocalDocumentRepository(DataCubeDatabase.get(app).documents(), app.filesDir)
 val documents = repo.documents.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())
 fun import(uri: Uri, name: String, done: (Result<Unit>) -> Unit) { viewModelScope.launch { runCatching { repo.import(uri,getApplication<Application>().contentResolver,name); Unit }.also(done) } }
 fun delete(id: String) { viewModelScope.launch { repo.delete(id) } }
}
