package au.datacube.app.data.rag

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.util.UUID
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LocalDocumentChatHistoryTest {
    @Test fun conversationsPersistPerDocumentAndCanBeCleared() = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val store = LocalDocumentChatHistory(context)
        val first = UUID.randomUUID().toString()
        val second = UUID.randomUUID().toString()
        try {
            store.save(first, listOf(
                SavedDocumentTurn("What is an atom?", "An atom is mentioned [1].", false,
                    matches = listOf(SavedSource("An atom is a unit of matter.", 4)),
                    steps = listOf("Ranked passages with local BM25"), workDurationMs = 19500L)
            ))
            store.save(second, listOf(SavedDocumentTurn("Hello", "", true)))
            val restored = store.load(first)
            assertEquals(1, restored.size)
            assertEquals("What is an atom?", restored.single().question)
            assertEquals(4, restored.single().matches.single().page)
            assertEquals("An atom is mentioned [1].", restored.single().answer)
            assertEquals(19500L, restored.single().workDurationMs)
            assertFalse(store.load(second).isEmpty())
            store.clear(first)
            assertTrue(store.load(first).isEmpty())
            assertFalse(store.load(second).isEmpty())
        } finally {
            store.clear(first)
            store.clear(second)
        }
    }

    @Test fun deletingThreadsRemovesOwnedHistoryAndAudioWithoutAffectingOtherWorkspaces() = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val threads = LocalConversationThreads(context)
        val history = LocalDocumentChatHistory(context)
        val owner = "global-" + UUID.randomUUID()
        val other = "global-" + UUID.randomUUID()
        val base = java.io.File(context.filesDir, "voice-notes/$owner").apply { mkdirs() }
        val voice = java.io.File(base, "test.wav").apply { writeText("test fixture") }
        val first = threads.list(owner).activeId
        val second = threads.create(owner).activeId
        try {
            history.save(LocalConversationThreads.historyKey(owner, first), listOf(SavedDocumentTurn("First", "", true, audioPath = voice.absolutePath)))
            history.save(LocalConversationThreads.historyKey(owner, second), listOf(SavedDocumentTurn("Second", "", true)))
            history.save(other, listOf(SavedDocumentTurn("Other workspace", "", true)))
            val remaining = threads.deleteChats(owner, setOf(first), false)
            assertEquals(listOf(second), remaining.threads.map { it.id })
            assertTrue(history.load(LocalConversationThreads.historyKey(owner, first)).isEmpty())
            assertFalse(voice.exists())
            assertFalse(history.load(LocalConversationThreads.historyKey(owner, second)).isEmpty())
            val cleared = threads.deleteChats(owner, setOf(second), true)
            assertEquals(1, cleared.threads.size)
            assertTrue(cleared.activeId != first && cleared.activeId != second)
            assertTrue(history.load(LocalConversationThreads.historyKey(owner, second)).isEmpty())
            assertTrue(history.load(LocalConversationThreads.historyKey(owner, cleared.activeId)).isEmpty())
            assertFalse(history.load(other).isEmpty())
        } finally {
            threads.clear(owner)
            threads.clear(other)
            base.deleteRecursively()
        }
    }
}
