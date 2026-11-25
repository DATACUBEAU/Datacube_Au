package au.datacube.app

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import au.datacube.app.data.ExtractedTextStore
import au.datacube.app.ui.documents.PersistentStudyNotes
import au.datacube.app.ui.documents.SourceSnippet
import au.datacube.app.ui.common.ResponseFeedbackStore
import kotlinx.coroutines.runBlocking
import java.io.File
import java.util.UUID
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class StudyPersistenceTest {
    @Test fun completedNotesRestoreAndChangedSourceInvalidatesThem() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val id = UUID.randomUUID().toString()
        val source = ExtractedTextStore.fileFor(context.filesDir,id)
        source.parentFile?.mkdirs()
        try {
            source.writeText("Newton's laws describe motion.")
            val hash = requireNotNull(PersistentStudyNotes.sourceHash(context.filesDir,id))
            PersistentStudyNotes.save(context.filesDir,id,hash,"TOPIC: Motion\nNewton's laws describe motion. [1]",
                listOf(SourceSnippet("Newton's laws describe motion.",1)))
            val restored = requireNotNull(PersistentStudyNotes.load(context.filesDir,id))
            assertEquals(1,restored.sources.single().page)
            assertTrue(restored.text.contains("[1]"))
            source.writeText("Different source.")
            assertNull(PersistentStudyNotes.load(context.filesDir,id))
        } finally {
            PersistentStudyNotes.delete(context.filesDir,id)
            source.delete()
        }
    }

    @Test fun responseFeedbackIsScopedAndStable() {
        val one = ResponseFeedbackStore.id("physics:chat1",2,100L)
        assertEquals(one,ResponseFeedbackStore.id("physics:chat1",2,100L))
        assertNotEquals(one,ResponseFeedbackStore.id("physics:chat2",2,100L))
        assertNotEquals(one,ResponseFeedbackStore.id("physics:chat1",2,101L))
    }
}
