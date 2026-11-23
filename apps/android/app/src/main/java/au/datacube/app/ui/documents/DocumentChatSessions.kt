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
    var searching by mutableStateOf(false)
    var searchingStage by mutableStateOf("")
    var activeRequest: Job? = null
    var historyReady by mutableStateOf(false)
        private set
    private var initialized = false

    fun initialize(context: Context) {
        if (initialized) return
        initialized = true
        val appContext = context.applicationContext
        scope.launch {
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
                        generationError = if (turn.interrupted) "Previous response stopped before completion." else null
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
                            interrupted = item.generating
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

    fun forgetDocument(documentId: String) {
        sessions.keys.filter { it == documentId || it.startsWith("$documentId--") }.forEach { key ->
            sessions.remove(key)?.stop()
        }
    }

    fun releaseAll() {
        sessions.values.forEach { it.stop() }
        sessions.clear()
    }
}
