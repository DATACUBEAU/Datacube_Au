package au.datacube.app.data.rag

import android.content.Context
import android.util.AtomicFile
import java.io.File
import org.json.JSONArray
import org.json.JSONObject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

data class SavedSource(val text: String, val page: Int?, val documentId: String? = null, val documentName: String? = null)
data class SavedDocumentTurn(
    val question: String,
    val answer: String,
    val isUser: Boolean,
    val matches: List<SavedSource> = emptyList(),
    val semantic: Boolean = false,
    val overview: Boolean = false,
    val steps: List<String> = emptyList(),
    val corrections: Map<String, String> = emptyMap(),
    val interrupted: Boolean = false,
    val audioPath: String? = null,
    val createdAtEpochMs: Long? = null
)

/** Local conversation history, scoped to a document ID. No network writes or cloud sync. */
class LocalDocumentChatHistory(filesDir: File) {
    constructor(context: Context) : this(context.filesDir)

    private val root = File(filesDir, "document-chat-history")

    suspend fun load(documentId: String): List<SavedDocumentTurn> = withContext(Dispatchers.IO) {
        lock.withLock {
            val file = fileFor(documentId)
            if (!file.isFile || file.length() > MAX_BYTES) return@withLock emptyList()
            runCatching {
                val content = AtomicFile(file).openRead().bufferedReader().use { it.readText() }
                val wrapper = JSONObject(content)
                check(wrapper.optInt("version") == 1) { "Unsupported history version." }
                val array = wrapper.optJSONArray("turns") ?: JSONArray()
                (0 until minOf(array.length(), MAX_TURNS)).mapNotNull { i ->
                    val entry = array.optJSONObject(i) ?: return@mapNotNull null
                    val sourceArray = entry.optJSONArray("sources") ?: JSONArray()
                    val sources = (0 until minOf(sourceArray.length(), MAX_SOURCES)).mapNotNull { index ->
                        val source = sourceArray.optJSONObject(index) ?: return@mapNotNull null
                        SavedSource(
                            text = source.optString("text").take(1500),
                            page = if (source.has("page") && !source.isNull("page"))
                                source.optInt("page") else null,
                            documentId = source.optString("documentId").takeIf { it.isNotBlank() }?.take(80),
                            documentName = source.optString("documentName").takeIf { it.isNotBlank() }?.take(160)
                        )
                    }
                    val steps = entry.optJSONArray("steps") ?: JSONArray()
                    val corrections = entry.optJSONObject("corrections") ?: JSONObject()
                    val map = linkedMapOf<String, String>()
                    corrections.keys().forEach { key -> if (map.size < 10) map[key] = corrections.optString(key) }
                    SavedDocumentTurn(
                        question = entry.optString("question").take(700),
                        answer = entry.optString("answer").take(12_000),
                        isUser = entry.optBoolean("user"),
                        matches = sources,
                        semantic = entry.optBoolean("semantic"),
                        overview = entry.optBoolean("overview"),
                        steps = (0 until minOf(steps.length(), 12))
                            .map { steps.optString(it).take(200) },
                        corrections = map,
                        interrupted = entry.optBoolean("interrupted"),
                        audioPath = if (!entry.has("audioPath") || entry.isNull("audioPath")) null
                            else entry.optString("audioPath").takeIf { it.isNotBlank() }?.take(280),
                        createdAtEpochMs = entry.optLong("createdAtEpochMs", 0L).takeIf { it > 0L }
                    )
                }
            }.getOrDefault(emptyList())
        }
    }

    suspend fun save(documentId: String, turns: List<SavedDocumentTurn>) = withContext(Dispatchers.IO) {
        lock.withLock {
            require(root.mkdirs() || root.isDirectory) { "Cannot open local history storage." }
            val file = fileFor(documentId)
            val wrapper = JSONObject()
            wrapper.put("version", 1)
            val arr = JSONArray()
            turns.takeLast(MAX_TURNS).forEach { turn ->
                val value = JSONObject()
                    .put("question", turn.question.take(700))
                    .put("answer", turn.answer.take(12_000))
                    .put("user", turn.isUser)
                    .put("semantic", turn.semantic)
                    .put("overview", turn.overview)
                    .put("interrupted", turn.interrupted)
                    .put("audioPath", turn.audioPath ?: JSONObject.NULL)
                    .put("createdAtEpochMs", turn.createdAtEpochMs ?: JSONObject.NULL)
                val matches = JSONArray()
                turn.matches.take(MAX_SOURCES).forEach { src ->
                    matches.put(JSONObject().put("text", src.text.take(1500))
                        .put("page", src.page ?: JSONObject.NULL)
                        .put("documentId", src.documentId ?: JSONObject.NULL)
                        .put("documentName", src.documentName ?: JSONObject.NULL))
                }
                value.put("sources", matches)
                val steps = JSONArray()
                turn.steps.take(12).forEach { steps.put(it.take(200)) }
                value.put("steps", steps)
                val corrections = JSONObject()
                turn.corrections.entries.take(10).forEach { corrections.put(it.key.take(60), it.value.take(60)) }
                value.put("corrections", corrections)
                arr.put(value)
            }
            wrapper.put("turns", arr)
            val bytes = wrapper.toString().toByteArray(Charsets.UTF_8)
            require(bytes.size < MAX_BYTES) { "History is too large to save." }
            val atomic = AtomicFile(file)
            val stream = atomic.startWrite()
            try {
                stream.write(bytes)
                atomic.finishWrite(stream)
            } catch (error: Exception) {
                atomic.failWrite(stream)
                throw error
            }
        }
    }

    suspend fun clear(documentId: String) = withContext(Dispatchers.IO) {
        lock.withLock {
            val file = fileFor(documentId)
            AtomicFile(file).delete()
            check(!file.exists() && !File(file.path + ".bak").exists() && !File(file.path + ".new").exists()) { "Could not clear history." }
        }
    }

    private fun fileFor(id: String): File {
        require(id.matches(Regex("[A-Za-z0-9_-]{1,128}"))) { "Invalid document ID." }
        return File(root, "$id.json")
    }

    companion object {
        const val MAX_TURNS = 40
        private const val MAX_SOURCES = 8
        private val lock = Mutex()
        private const val MAX_BYTES = 900_000L
    }
}
