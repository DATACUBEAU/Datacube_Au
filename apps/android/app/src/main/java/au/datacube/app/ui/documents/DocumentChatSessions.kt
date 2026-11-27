package au.datacube.app.ui.documents

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import au.datacube.app.data.rag.LocalDocumentChatHistory
import au.datacube.app.data.rag.LocalConversationThreads
import au.datacube.app.data.rag.SavedDocumentTurn
import au.datacube.app.data.rag.SavedSource
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.withContext
import java.io.File
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

/**
 * Process-lifetime workspaces, not composition-lifetime workspaces.
 * Navigating between files does NOT stop an in-flight local generation.
 * Android process death may interrupt native inference; committed turns are
 * restored from atomic private storage on the next app launch.
 */
internal class DocumentChatSession(private val historyKey: String) {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    val messages = mutableStateListOf<ChatMessage>()
    // Observed application actions live for this chat while generation is active.
    val activitySteps = mutableStateListOf<String>()
    var searching by mutableStateOf(false)
    var searchingStage by mutableStateOf("")
    var activeRequest: Job? = null
    var historyReady by mutableStateOf(false)
        private set
    private var initialized = false
    private var historyJob: Job? = null

    fun initialize(context: Context) {
        if (initialized) return
        initialized = true
        val appContext = context.applicationContext
        historyJob = scope.launch {
            val store = LocalDocumentChatHistory(appContext)
            try {
                val saved = store.load(historyKey)
                messages.clear()
                messages.addAll(saved.map { turn ->
                    ChatMessage(
                        question = turn.question,
                        matches = turn.matches.map {
                            SourceSnippet(it.text, it.page, it.documentId, it.documentName)
                        },
                        isUser = turn.isUser,
                        semantic = turn.semantic,
                        overview = turn.overview,
                        steps = turn.steps,
                        corrected = turn.corrections,
                        answer = turn.answer,
                        generationError = if (turn.interrupted) "Previous response stopped before completion." else null,
                        audioPath = turn.audioPath,
                        createdAtEpochMs = turn.createdAtEpochMs,
                        workDurationMs = turn.workDurationMs
                    )
                })
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                // Corrupt saved history must not block opening a document.
            } finally {
                historyReady = true
            }
            snapshotFlow { messages.toList() }.collectLatest { turns ->
                delay(650)
                try {
                    store.save(historyKey, turns.map { item ->
                        SavedDocumentTurn(
                            question = item.question,
                            answer = item.answer,
                            isUser = item.isUser,
                            matches = item.matches.map {
                                SavedSource(it.text, it.page, it.documentId, it.documentName)
                            },
                            semantic = item.semantic,
                            overview = item.overview,
                            steps = item.steps,
                            corrections = item.corrected,
                            interrupted = item.generating || item.generationError != null,
                            audioPath = item.audioPath,
                            createdAtEpochMs = item.createdAtEpochMs,
                            workDurationMs = item.workDurationMs
                        )
                    })
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (_: Exception) {
                    // Never crash the UI for a full or temporarily unavailable store.
                }
            }
        }
    }

    /** Clear only the selected idle conversation. Stop the saver before deleting
     * so a delayed snapshot cannot recreate the old history. */
    suspend fun clearHistory(context: Context, ownerId: String): Boolean {
        if (!historyReady || searching) return false
        require(ownerId.matches(Regex("[A-Za-z0-9_-]{1,80}")))
        searching = true
        historyReady = false
        try {
            historyJob?.cancelAndJoin()
            val audioPaths = messages.mapNotNull { it.audioPath }.distinct()
            LocalDocumentChatHistory(context).clear(historyKey)
            messages.clear()
            activitySteps.clear()
            return withContext(Dispatchers.IO) {
                val base = File(context.filesDir, "voice-notes/$ownerId").canonicalFile
                audioPaths.map { path ->
                    runCatching {
                        val file = File(path).canonicalFile
                        if (file.parentFile != base || file.extension != "wav") false
                        else !file.exists() || file.delete()
                    }.getOrDefault(false)
                }.all { it }
            }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            return false
        } finally {
            searching = false
            initialized = false
            if (scope.coroutineContext[Job]?.isActive == true) initialize(context)
        }
    }

    fun recordWorkDuration(firstIndex: Int, startedAt: Long) {
        val duration = (android.os.SystemClock.elapsedRealtime() - startedAt).coerceAtLeast(0L)
        for (index in firstIndex.coerceAtLeast(0) until messages.size) {
            val turn = messages[index]
            if (!turn.isUser && !turn.generating) messages[index] = turn.copy(workDurationMs = duration)
        }
    }

    fun stop() {
        activeRequest?.cancel()
        scope.cancel()
    }
}

internal object DocumentChatSessions {
    private val sessions = ConcurrentHashMap<String, DocumentChatSession>()

    fun get(ownerId: String, threadId: String, context: Context): DocumentChatSession {
        val key = LocalConversationThreads.historyKey(ownerId, threadId)
        val session = sessions.computeIfAbsent(key) { DocumentChatSession(key) }
        session.initialize(context)
        return session
    }

    /** Stop generation AND the debounced saver before deleting an owned history. */
    suspend fun detachForDeletion(ownerId: String, threadIds: List<String>): List<String> {
        val audio = mutableListOf<String>()
        for (id in threadIds) {
            val key = LocalConversationThreads.historyKey(ownerId, id)
            val session = sessions.remove(key) ?: continue
            session.stop()
            session.scope.coroutineContext[Job]?.join()
            audio += session.messages.mapNotNull { it.audioPath }
        }
        return audio
    }

    fun forgetDocument(documentId: String) {
        sessions.keys.filter { it == documentId || it.startsWith("$documentId--") }.forEach { key ->
            sessions.remove(key)?.stop()
        }
    }

    fun forgetGlobal() {
        sessions.keys.filter { it == "global" || it.startsWith("global--") || it.startsWith("global-") || it.contains("--c-") }.forEach { key ->
            sessions.remove(key)?.stop()
        }
    }

    fun releaseAll() {
        sessions.values.forEach { it.stop() }
        sessions.clear()
    }
}
