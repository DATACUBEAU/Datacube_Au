package au.datacube.app.data.rag

import android.content.Context
import android.util.AtomicFile
import java.io.File
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

data class ConversationThread(
    val id: String,
    val title: String,
    val createdAt: Long,
    val updatedAt: Long
)
data class ConversationThreadIndex(val activeId: String, val threads: List<ConversationThread>)

/**
 * Private document/global chat contexts. The legacy document history remains
 * thread "main", preserving existing saved conversations after this upgrade.
 */
class LocalConversationThreads(private val filesDir: File) {
    constructor(context: Context) : this(context.applicationContext.filesDir)

    private val root = File(filesDir, "chat-threads")

    suspend fun list(ownerId: String): ConversationThreadIndex = withContext(Dispatchers.IO) {
        mutex.withLock { read(ownerId) }
    }

    suspend fun create(ownerId: String): ConversationThreadIndex = withContext(Dispatchers.IO) {
        mutex.withLock {
            val old = read(ownerId)
            require(old.threads.size < MAX_THREADS) {
                "This workspace has $MAX_THREADS chats. Reuse an existing chat or remove older chats."
            }
            val now = System.currentTimeMillis()
            val next = ConversationThread(UUID.randomUUID().toString(), "New chat", now, now)
            val state = ConversationThreadIndex(next.id, old.threads + next)
            write(ownerId, state)
            state
        }
    }

    suspend fun activate(ownerId: String, threadId: String): ConversationThreadIndex =
        withContext(Dispatchers.IO) {
            mutex.withLock {
                val old = read(ownerId)
                require(old.threads.any { it.id == threadId }) { "Chat was not found." }
                val result = old.copy(activeId = threadId)
                write(ownerId, result)
                result
            }
        }

    suspend fun nameFromQuestion(ownerId: String, threadId: String, question: String) =
        withContext(Dispatchers.IO) {
            mutex.withLock {
                val current = read(ownerId)
                val now = System.currentTimeMillis()
                val title = question.replace(Regex("""\s+"""), " ").trim().take(54)
                val updated = current.threads.map {
                    if (it.id == threadId) it.copy(
                        title = if (it.title == "New chat") title.ifBlank { "Chat" } else it.title,
                        updatedAt = now
                    ) else it
                }
                write(ownerId, current.copy(threads = updated))
            }
        }

    suspend fun clear(ownerId: String) = withContext(Dispatchers.IO) {
        mutex.withLock {
            val current = read(ownerId)
            val history = LocalDocumentChatHistory(filesDir)
            current.threads.forEach { history.clear(historyKey(ownerId, it.id)) }
            // Also clear unexpected orphan thread files from earlier incomplete saves.
            val historyFolder = File(filesDir, "document-chat-history")
            historyFolder.listFiles()?.filter { it.name.startsWith("$ownerId--") }?.forEach { it.delete() }
            AtomicFile(fileFor(ownerId)).delete()
        }
    }

    /**
     * Deleting an imported file must not leave its extracted text in Discs
     * citations or generated reply history. Other unrelated chats survive.
     */
    suspend fun redactDeletedDocument(documentId: String) = withContext(Dispatchers.IO) {
        // Iterate only account-scoped Discs metadata in private app storage.
        // Accounts must not share a single unscoped global chat history.
        val owners = root.listFiles().orEmpty().filter { file ->
            file.isFile && file.extension == "json" &&
                (file.nameWithoutExtension == "global" ||
                 file.nameWithoutExtension.startsWith("global-"))
        }.map { it.nameWithoutExtension }.filter { safeId(it) }

        val histories = LocalDocumentChatHistory(filesDir)
        for (owner in owners) {
            val state = list(owner)
            for (thread in state.threads) {
                val key = historyKey(owner, thread.id)
                val turns = histories.load(key)
                if (turns.none { turn -> turn.matches.any { it.documentId == documentId } }) continue
                histories.save(key, turns.map { turn ->
                    if (turn.matches.any { it.documentId == documentId }) {
                        turn.copy(
                            answer = "This reply was removed because a supporting document was deleted.",
                            matches = emptyList(),
                            steps = emptyList(),
                            interrupted = false
                        )
                    } else turn
                })
            }
        }
    }

    private fun read(ownerId: String): ConversationThreadIndex {
        val file = fileFor(ownerId)
        if (!file.isFile || file.length() > 32_000L) return initial()
        return runCatching {
            val root = JSONObject(AtomicFile(file).openRead().bufferedReader().use { it.readText() })
            check(root.optInt("version") == 1)
            val items = root.optJSONArray("threads") ?: JSONArray()
            val threads = (0 until minOf(items.length(), MAX_THREADS)).mapNotNull { index ->
                val entry = items.optJSONObject(index) ?: return@mapNotNull null
                val id = entry.optString("id")
                if (!safeId(id)) return@mapNotNull null
                ConversationThread(
                    id, entry.optString("title", "New chat").take(70),
                    entry.optLong("createdAt"), entry.optLong("updatedAt")
                )
            }.distinctBy { it.id }
            if (threads.isEmpty()) initial() else ConversationThreadIndex(
                root.optString("active").takeIf { active -> threads.any { it.id == active } }
                    ?: threads.first().id,
                threads
            )
        }.getOrElse { initial() }
    }

    private fun write(ownerId: String, index: ConversationThreadIndex) {
        require(root.mkdirs() || root.isDirectory)
        val data = JSONObject().put("version", 1).put("active", index.activeId)
        val threads = JSONArray()
        index.threads.forEach {
            threads.put(JSONObject().put("id", it.id).put("title", it.title)
                .put("createdAt", it.createdAt).put("updatedAt", it.updatedAt))
        }
        data.put("threads", threads)
        val bytes = data.toString().toByteArray(Charsets.UTF_8)
        require(bytes.size <= 32_000) { "Too many local chat histories." }
        val file = AtomicFile(fileFor(ownerId))
        val stream = file.startWrite()
        try {
            stream.write(bytes)
            file.finishWrite(stream)
        } catch (error: Exception) {
            file.failWrite(stream)
            throw error
        }
    }

    private fun fileFor(ownerId: String): File {
        require(safeId(ownerId)) { "Invalid workspace ID." }
        return File(root, "$ownerId.json")
    }

    private fun initial(): ConversationThreadIndex = ConversationThreadIndex(
        "main", listOf(ConversationThread("main", "Original chat", 0L, 0L))
    )

    companion object {
        const val MAX_THREADS = 24
        private val mutex = Mutex()
        private fun safeId(id: String) = id.matches(Regex("[A-Za-z0-9_-]{1,80}"))
        fun historyKey(ownerId: String, threadId: String): String {
            require(safeId(ownerId) && safeId(threadId)) { "Invalid chat identity." }
            return if (threadId == "main") ownerId else "$ownerId--$threadId"
        }
    }
}

/** A new chat creates a genuinely new bounded context, not hidden unlimited history. */
object ConversationWindow {
    const val WARN_AFTER = 16
    const val MAX_USER_TURNS = 20
    fun warning(userTurns: Int): String? = when {
        userTurns >= MAX_USER_TURNS -> "Conversation limit reached. Start a new chat to continue."
        userTurns >= WARN_AFTER -> "This chat is getting long. You can start a new chat at any time."
        else -> null
    }
}
