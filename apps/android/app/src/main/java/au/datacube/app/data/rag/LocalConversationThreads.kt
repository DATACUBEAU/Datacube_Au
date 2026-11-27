package au.datacube.app.data.rag

import android.content.Context
import android.util.AtomicFile
import java.io.File
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
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

    /** Explicit recall stays inside the current workspace; ordinary new chats stay independent. */
    suspend fun yesterdayReply(ownerId: String, activeThreadId: String,
        activeEntries: List<ConversationEntry>): String = withContext(Dispatchers.IO) {
        val history = LocalDocumentChatHistory(filesDir)
        val entries = activeEntries.toMutableList()
        for (thread in list(ownerId).threads) {
            kotlinx.coroutines.currentCoroutineContext().ensureActive()
            if (thread.id == activeThreadId) continue
            entries += history.load(historyKey(ownerId, thread.id)).map {
                ConversationEntry(it.question, it.createdAtEpochMs, it.isUser)
            }
        }
        AuConversationContext.yesterdayReply(entries)
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

    /** Caller has already joined live session writers for the selected threads. */
    suspend fun deleteChats(ownerId: String, threadIds: Set<String>, all: Boolean,
        unsavedAudio: List<String> = emptyList()): ConversationThreadIndex = withContext(Dispatchers.IO) {
        mutex.withLock {
            require(safeId(ownerId))
            val current = read(ownerId)
            val removed = if (all) current.threads else current.threads.filter { it.id in threadIds }
            require(removed.isNotEmpty()) { "Chat was not found." }
            val history = LocalDocumentChatHistory(filesDir)
            val voiceRoot = File(filesDir, "voice-notes/$ownerId").canonicalFile
            val audio = (unsavedAudio + removed.flatMap { thread ->
                history.load(historyKey(ownerId, thread.id)).mapNotNull { it.audioPath }
            }).distinct()
            for (thread in removed) history.clear(historyKey(ownerId, thread.id))
            if (all) {
                val folder = File(filesDir, "document-chat-history")
                folder.listFiles().orEmpty().filter { it.name.startsWith("$ownerId--") }.forEach {
                    check(it.delete() || !it.exists()) { "Could not remove an old chat." }
                }
                check(voiceRoot.deleteRecursively() || !voiceRoot.exists()) { "Could not remove voice notes." }
            } else {
                val retainedPaths = current.threads.filterNot { it in removed }.flatMap { thread ->
                    history.load(historyKey(ownerId, thread.id)).mapNotNull { it.audioPath }
                }.toSet()
                for (path in audio.filterNot { it in retainedPaths }) {
                    val file = File(path).canonicalFile
                    if (file.parentFile == voiceRoot && file.extension == "wav")
                        check(file.delete() || !file.exists()) { "Could not remove a voice note." }
                }
            }
            val remaining = current.threads.filterNot { it in removed }.ifEmpty {
                val now = System.currentTimeMillis()
                listOf(ConversationThread(UUID.randomUUID().toString(), "New chat", now, now))
            }
            val result = ConversationThreadIndex(current.activeId.takeIf { active -> remaining.any { it.id == active } }
                ?: remaining.maxBy { it.updatedAt }.id, remaining)
            write(ownerId, result)
            result
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

    suspend fun clearCollectionDocumentChats(documentId: String) = withContext(Dispatchers.IO) {
        require(safeId(documentId))
        val histories = File(filesDir, "document-chat-history")
        val voices = File(filesDir, "voice-notes")
        val pattern = Regex("^" + Regex.escape(documentId) + "--c-[a-f0-9]{16}")
        val owners = (root.listFiles().orEmpty().asList() + histories.listFiles().orEmpty().asList() +
            voices.listFiles().orEmpty().asList()).mapNotNull { pattern.find(it.name)?.value }
            .filter { safeId(it) }.distinct()
        for (owner in owners) {
            clear(owner)
            au.datacube.app.ui.voice.LocalVoiceNoteRecorder.clearOwner(filesDir, owner)
        }
    }

    /**
     * Deleting an imported file must not leave its extracted text in Discs
     * citations or generated reply history. Other unrelated chats survive.
     */
    suspend fun redactDeletedDocument(documentId: String) = withContext(Dispatchers.IO) {
        // Enumerate persisted histories, including a main thread that has no metadata file.
        val historyFolder = File(filesDir, "document-chat-history")
        val keys = historyFolder.listFiles().orEmpty().filter {
            it.isFile && it.extension == "json" && (it.name.startsWith("global") || it.name.contains("--c-"))
        }.map { it.nameWithoutExtension }.filter { it.matches(Regex("[A-Za-z0-9_-]{1,128}")) }
        val histories = LocalDocumentChatHistory(filesDir)
        for (key in keys) {
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
