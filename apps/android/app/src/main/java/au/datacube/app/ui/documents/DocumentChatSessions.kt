package au.datacube.app.ui.documents

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import au.datacube.app.data.rag.LocalDocumentChatHistory
import au.datacube.app.data.rag.LocalGenerativeEngine
import au.datacube.app.data.rag.LocalComputeGate
import au.datacube.app.ui.voice.RecordedVoiceNote
import au.datacube.app.data.rag.LocalConversationThreads
import au.datacube.app.data.rag.SavedDocumentTurn
import au.datacube.app.data.rag.SavedSource
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
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
    var requestStartedAt by mutableStateOf(0L)
        private set

    // Keep at most one alternate for the latest exchange in process memory.
    // The selected response, not the alternate, is saved by the history writer.
    private var alternate by mutableStateOf<ChatMessage?>(null)
    private var alternateIndex by mutableStateOf(-1)

    fun startRequestClock(): Long {
        if (messages.size != alternateIndex) {
            alternate = null
            alternateIndex = -1
        }
        return android.os.SystemClock.elapsedRealtime().also { requestStartedAt = it }
    }

    fun beginRegeneration(index: Int): String? {
        val question = regenerationQuestion(index) ?: return null
        val previous = messages[index]
        if (previous.answer.isNotBlank() && previous.generationError == null) {
            alternate = previous
            alternateIndex = index
        }
        messages.removeAt(index)
        return question
    }

    fun hasAlternate(index: Int): Boolean =
        !searching && index == messages.lastIndex && index == alternateIndex && alternate != null

    fun swapAlternate(index: Int) {
        if (!hasAlternate(index)) return
        val prior = alternate ?: return
        alternate = messages[index]
        messages[index] = prior
    }

    fun publishAnswer(index: Int, answer: String) {
        val turn = messages.getOrNull(index) ?: return
        if (turn.answer == answer || !turn.generating) return
        val first = turn.firstVisibleMs ?: if (answer.isNotBlank() && requestStartedAt > 0L)
            (android.os.SystemClock.elapsedRealtime() - requestStartedAt).coerceAtLeast(0L) else null
        messages[index] = turn.copy(answer = answer, firstVisibleMs = first)
        if (first != null && turn.firstVisibleMs == null && au.datacube.app.BuildConfig.DEBUG) {
            android.util.Log.d("AuInferenceTiming", "firstVisibleMs=$first sourceCount=${turn.matches.size}")
        }
    }

    /** Audio transcription hands off to the same scoped chat request. Keep the
     * original start time and the audio bubble; never leak an unfinished job. */
    fun submitVoiceNote(context: Context, note: RecordedVoiceNote, onTranscribed: (String, String, String) -> Unit) {
        if (!historyReady || searching) {
            note.file.delete()
            return
        }
        val label = "Voice note · " + note.durationSeconds + "s"
        messages.add(ChatMessage(label, emptyList(), true, audioPath = note.file.absolutePath))
        val firstIndex = messages.size
        val startedAt = startRequestClock()
        searching = true
        searchingStage = "AU is listening"
        activitySteps.clear()
        val job = scope.launch(start = CoroutineStart.LAZY) {
            var handedOff = false
            try {
                val words = LocalComputeGate.interactiveRequest {
                    LocalGenerativeEngine.understandVoiceNote(context.applicationContext, note.file)
                }
                searching = false
                searchingStage = ""
                activeRequest = null
                onTranscribed(words, label, note.file.absolutePath)
                handedOff = searching || messages.size > firstIndex
                if (!handedOff) {
                    messages.add(ChatMessage(label, emptyList(), false,
                        generationError = "Chat could not start the voice reply. Try again."))
                }
            } catch (cancelled: CancellationException) {
                messages.add(ChatMessage(label, emptyList(), false, generationError = "Voice request stopped."))
                throw cancelled
            } catch (error: Exception) {
                messages.add(ChatMessage(label, emptyList(), false,
                    generationError = error.message ?: "AU could not understand this audio."))
            } finally {
                if (!handedOff) finishRequest(firstIndex, startedAt, false) {}
            }
        }
        activeRequest = job
        job.start()
    }

    /** Only the latest ordinary text exchange can be regenerated without
     * replaying a voice note, memory command, scheduling action or attachment. */
    fun regenerationQuestion(index: Int): String? {
        if (!historyReady || searching || index != messages.lastIndex || index < 1) return null
        val answer = messages[index]
        val user = messages[index - 1]
        if (answer.isUser || answer.generating || !user.isUser || user.audioPath != null ||
            user.question.isBlank() || user.question.contains("\nAttachment:") ||
            au.datacube.app.data.rag.AuMemoryCommand.parse(user.question) != null ||
            au.datacube.app.schedule.AuScheduleIntent.matches(user.question)) return null
        return user.question
    }

    fun streamingAnswer(index: Int, sourceCount: Int): AuStreamingAnswer =
        AuStreamingAnswer(sourceCount) { visible ->
            withContext(Dispatchers.Main.immediate) { publishAnswer(index, visible) }
        }
    var activeRequest: Job? = null

    /** Assign before running: even an immediate local reply must clear the correct job. */
    fun launchRequest(block: suspend CoroutineScope.() -> Unit) {
        val job = scope.launch(start = CoroutineStart.LAZY) {
            LocalComputeGate.interactiveRequest { block(this@launch) }
        }
        activeRequest = job
        job.start()
    }
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
                        workDurationMs = turn.workDurationMs,
                        firstVisibleMs = turn.firstVisibleMs
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
                            workDurationMs = item.workDurationMs,
                            firstVisibleMs = item.firstVisibleMs
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
            alternate = null
            alternateIndex = -1
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

    /** One cleanup path for text, attachment and grounded requests. Notifications
     * are best effort; a notification failure must never lock the composer. */
    fun finishRequest(firstIndex: Int, startedAt: Long, successful: Boolean, notify: () -> Unit) {
        try {
            for (index in firstIndex.coerceAtLeast(0) until messages.size) {
                val turn = messages[index]
                if (!turn.isUser && turn.generating) messages[index] = turn.copy(
                    generating = false, generationError = if (successful) "Response could not finish." else "Reply stopped.")
            }
            recordWorkDuration(firstIndex, startedAt)
            if (successful && messages.drop(firstIndex).any {
                !it.isUser && !it.generating && it.generationError == null &&
                    "Answered a simple greeting locally" !in it.steps &&
                    (it.answer.isNotBlank() || it.matches.isNotEmpty())
            }) runCatching { notify() }.onFailure {
                android.util.Log.w("AuChat", "Response notification could not be delivered", it)
            }
        } finally {
            searching = false
            searchingStage = ""
            activitySteps.clear()
            activeRequest = null
            requestStartedAt = 0L
        }
    }

    fun recordWorkDuration(firstIndex: Int, startedAt: Long) {
        val duration = (android.os.SystemClock.elapsedRealtime() - startedAt).coerceAtLeast(0L)
        for (index in firstIndex.coerceAtLeast(0) until messages.size) {
            val turn = messages[index]
            if (!turn.isUser && !turn.generating) messages[index] = turn.copy(workDurationMs = duration,
                firstVisibleMs = turn.firstVisibleMs)
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
