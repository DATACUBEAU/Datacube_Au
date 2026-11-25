package au.datacube.app.ui.documents

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import au.datacube.app.data.ExtractedTextStore
import java.util.UUID
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PersistentStudyNotesTest {
    @Test fun persistedNotesAreBoundToTheExactSource() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val id = UUID.randomUUID().toString()
        val source = ExtractedTextStore.fileFor(context.filesDir,id)
        try {
            source.parentFile?.mkdirs()
            source.writeText("Motion is a change in position.")
            val hash = requireNotNull(PersistentStudyNotes.sourceHash(context.filesDir,id))
            PersistentStudyNotes.save(context.filesDir,id,hash,"TOPIC: Motion\nMotion changes position [1].",
                listOf(SourceSnippet("Motion is a change in position.",1)))
            val restored = requireNotNull(PersistentStudyNotes.load(context.filesDir,id))
            assertTrue(restored.text.contains("Motion"))
            assertEquals(1,restored.sources.single().page)
            source.writeText("A different source.")
            assertNull(PersistentStudyNotes.load(context.filesDir,id))
        } finally {
            PersistentStudyNotes.delete(context.filesDir,id)
            source.delete()
        }
    }
}
