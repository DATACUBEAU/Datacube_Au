package au.datacube.app.data
import android.content.ContentResolver
import android.net.Uri
import android.webkit.MimeTypeMap
import java.io.File
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.withContext
class LocalDocumentRepository(private val dao: LocalDocumentDao, private val filesDir: File) {
 val documents: Flow<List<LocalDocument>> = dao.observeAll()
 suspend fun import(uri: Uri, resolver: ContentResolver, name: String): LocalDocument = withContext(Dispatchers.IO) {
  val ext = name.substringAfterLast('.', "").lowercase()
  require(ext in setOf("pdf","docx","txt","rtf","md")) { "Unsupported document type." }
  val id = UUID.randomUUID().toString()
  val folder = File(filesDir, "documents").apply { mkdirs() }
  val target = File(folder, "$id.$ext")
  try {
   resolver.openInputStream(uri)?.use { input -> target.outputStream().use { output ->
    val buffer = ByteArray(8192); var total = 0L
    while (true) { val n = input.read(buffer); if (n < 0) break; total += n; require(total <= 100L*1024L*1024L) { "File exceeds 100 MB." }; output.write(buffer,0,n) }
    require(total > 0) { "Selected file is empty." }
   }} ?: error("Cannot read selected file.")
   val mime = resolver.getType(uri) ?: MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "application/octet-stream"
   LocalDocument(id,name,ext,mime,target.length(),target.absolutePath,System.currentTimeMillis()).also { dao.insert(it) }
  } catch (e: Throwable) { target.delete(); throw e }
 }
 suspend fun delete(id: String) = withContext(Dispatchers.IO) {
  dao.find(id)?.let { dao.delete(id); File(it.privatePath).delete() }
 }
}
