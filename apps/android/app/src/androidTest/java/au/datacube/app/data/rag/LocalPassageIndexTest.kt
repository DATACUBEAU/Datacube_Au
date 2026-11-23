package au.datacube.app.data.rag

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import java.io.File
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LocalPassageIndexTest {
    @Test
    fun indexesLateDocumentContentBeyondPreviewAndDeletesIt() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val id = "test-" + UUID.randomUUID()
        val file = File(context.cacheDir, id + ".txt")
        val index = LocalPassageIndex(context)
        try {
            file.writeText(
                "----- Page 1 -----\n" +
                    ("Ordinary introductory paragraphs about history and science. ").repeat(6_000) +
                    "\n----- Page 27 -----\n" +
                    "Photovoltaic inverter circuits convert solar panel direct current into alternating current for buildings. " +
                    "The inverter improves the use of rooftop solar power."
            )
            assertTrue(file.length() > 240_000)
            val passages = index.build(id, file)
            assertTrue(passages > 200)
            assertTrue(index.hasCurrent(id, file))
            val matches = index.search(id, "photovoltaic inverter", file, limit = 4)
            assertTrue(matches.isNotEmpty())
            assertTrue(matches.any { it.page == 27 && it.text.contains("Photovoltaic") })
            assertTrue(index.overview(id, file).isNotEmpty())
            index.remove(id)
            assertFalse(index.hasCurrent(id, file))
        } finally {
            index.remove(id)
            index.close()
            file.delete()
        }
    }

    @Test
    fun changesToDocumentInvalidateSearchIndex() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val id = "test-" + UUID.randomUUID()
        val file = File(context.cacheDir, id + ".txt")
        val index = LocalPassageIndex(context)
        try {
            file.writeText(
                "----- Page 1 -----\n" +
                    "A quantum computing introduction explains qubits and quantum gates with examples."
            )
            index.build(id, file)
            assertTrue(index.search(id, "quantum gates", file).isNotEmpty())
            file.writeText(
                "----- Page 1 -----\n" +
                    "A geography introduction explains plate tectonics and the formation of mountain ranges in detail."
            )
            assertFalse(index.hasCurrent(id, file))
            index.build(id, file)
            assertTrue(index.search(id, "tectonics", file).isNotEmpty())
            assertTrue(index.search(id, "quantum", file).isEmpty())
        } finally {
            index.remove(id)
            index.close()
            file.delete()
        }
    }
    @Test
    fun transactionRollsBackIfIndexingIsInterruptedDuringProgress() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val id = "test-" + UUID.randomUUID()
        val file = File(context.cacheDir, "$id.txt")
        val index = LocalPassageIndex(context)
        try {
            file.writeText("----- Page 1 -----\\n" +
                ("A stable baseline describes magnetic resonance techniques. ").repeat(300))
            val originalCount = index.build(id, file)
            assertTrue(originalCount > 0)

            file.writeText("----- Page 2 -----\\n" +
                ("The new, interrupted revision discusses photovoltaic cells. ").repeat(2_000))

            var callbacks = 0
            val interrupted = runCatching {
                index.build(id, file) { completed ->
                    callbacks++
                    if (completed >= 100) throw CancellationException("Stop indexing")
                }
            }.exceptionOrNull()

            assertTrue(interrupted is CancellationException)
            assertTrue(callbacks >= 1)
            // No uncommitted replacement passages survive the interruption.
            index.readableDatabase.rawQuery(
                "SELECT COUNT(*) FROM passages WHERE documentId = ?",
                arrayOf(id)
            ).use { cursor ->
                assertTrue(cursor.moveToFirst())
                assertTrue(cursor.getInt(0) == originalCount)
            }
            assertFalse(index.hasCurrent(id, file))
        } finally {
            index.remove(id)
            index.close()
            file.delete()
        }
    }

}
