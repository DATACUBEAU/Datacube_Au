package au.datacube.app.ui.documents

import android.util.AtomicFile
import au.datacube.app.data.ExtractedTextStore
import java.io.File
import java.security.MessageDigest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

/** Only completed notes are persisted; a changed or deleted source invalidates them. */
internal object PersistentStudyNotes {
    private val lock = Mutex()
    internal data class Saved(val text: String, val sources: List<SourceSnippet>, val sourceHash: String)
    private fun file(root: File, id: String): File {
        require(id.matches(Regex("[A-Za-z0-9_-]{1,80}")))
        return File(root, "study-notes/$id.json")
    }

    suspend fun sourceHash(root: File, id: String): String? = withContext(Dispatchers.IO) {
        val source = ExtractedTextStore.fileFor(root,id)
        if (!source.isFile || source.length() > 100L * 1024 * 1024) return@withContext null
        val hash = MessageDigest.getInstance("SHA-256")
        source.inputStream().buffered().use { input ->
            val bytes = ByteArray(64 * 1024)
            while (true) {
                currentCoroutineContext().ensureActive()
                val n = input.read(bytes)
                if (n < 0) break
                hash.update(bytes,0,n)
            }
        }
        hash.digest().joinToString("") { "%02x".format(it) }
    }

    suspend fun load(root: File,id: String): Saved? = withContext(Dispatchers.IO) {
        lock.withLock {
            val target = file(root,id)
            if (!target.isFile || target.length() > 256_000) return@withLock null
            val hash = sourceHash(root,id) ?: return@withLock null
            val json = JSONObject(AtomicFile(target).openRead().bufferedReader().use { it.readText() })
            if (json.optInt("version") != 1 || json.optString("sourceHash") != hash) return@withLock null
            val raw = json.optJSONArray("sources") ?: return@withLock null
            val sources = (0 until minOf(raw.length(),8)).mapNotNull { i ->
                val item = raw.optJSONObject(i) ?: return@mapNotNull null
                SourceSnippet(item.optString("text").take(1300),
                    if (item.isNull("page")) null else item.optInt("page"))
            }
            val text = json.optString("text").take(12_000)
            if (text.isBlank() || sources.isEmpty()) null else Saved(text,sources,hash)
        }
    }

    suspend fun save(root: File,id: String,expectedHash: String,text: String,sources: List<SourceSnippet>) =
        withContext(Dispatchers.IO) {
            lock.withLock {
                check(sourceHash(root,id) == expectedHash) { "The document changed. Regenerate notes." }
                require(text.isNotBlank() && sources.isNotEmpty())
                val target = file(root,id)
                check(target.parentFile?.let { it.isDirectory || it.mkdirs() } == true)
                val rows = JSONArray()
                sources.take(8).forEach { rows.put(JSONObject().put("text",it.text.take(1300))
                    .put("page",it.page ?: JSONObject.NULL)) }
                val bytes = JSONObject().put("version",1).put("sourceHash",expectedHash)
                    .put("text",text.take(12_000)).put("sources",rows).toString().toByteArray(Charsets.UTF_8)
                require(bytes.size <= 256_000)
                val atomic = AtomicFile(target)
                val output = atomic.startWrite()
                try { output.write(bytes); atomic.finishWrite(output) }
                catch (e: Exception) { atomic.failWrite(output); throw e }
            }
        }

    suspend fun delete(root: File,id: String) = withContext(Dispatchers.IO) {
        lock.withLock { AtomicFile(file(root,id)).delete() }
    }
}
