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
                    steps = listOf("Ranked passages with local BM25"))
            ))
            store.save(second, listOf(SavedDocumentTurn("Hello", "", true)))
            val restored = store.load(first)
            assertEquals(1, restored.size)
            assertEquals("What is an atom?", restored.single().question)
            assertEquals(4, restored.single().matches.single().page)
            assertEquals("An atom is mentioned [1].", restored.single().answer)
            assertFalse(store.load(second).isEmpty())
            store.clear(first)
            assertTrue(store.load(first).isEmpty())
            assertFalse(store.load(second).isEmpty())
        } finally {
            store.clear(first)
            store.clear(second)
        }
    }
}
