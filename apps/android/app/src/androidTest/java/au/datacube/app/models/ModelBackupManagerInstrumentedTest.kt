package au.datacube.app.models

import android.content.Context
import android.net.Uri
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.io.File
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ModelBackupManagerInstrumentedTest {
    private lateinit var context: Context
    private lateinit var installedModels: File
    private lateinit var backupFile: File

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        installedModels = File(context.filesDir, "models/installed")
        installedModels.deleteRecursively()
        backupFile = File(context.cacheDir, "model-backup-test.zip")
        backupFile.delete()
    }

    @After
    fun tearDown() {
        installedModels.deleteRecursively()
        backupFile.delete()
    }

    @Test
    fun exportsAndRestoresNestedModelFilesWithIntegrityChecks() = runBlocking {
        val modelDirectory = File(installedModels, "embedding-test-v1")
        val nestedDirectory = File(modelDirectory, "tokenizer")
        assertTrue(nestedDirectory.mkdirs())
        val modelBytes = ByteArray(256 * 1024) { (it % 251).toByte() }
        val tokenizerBytes = "tokenizer fixture".toByteArray()
        File(modelDirectory, "model.onnx").writeBytes(modelBytes)
        File(nestedDirectory, "tokenizer.json").writeBytes(tokenizerBytes)

        val manager = ModelBackupManager(context)
        val exported = manager.exportBackup(Uri.fromFile(backupFile))

        assertEquals(1, exported.modelCount)
        assertEquals(2, exported.fileCount)
        assertTrue(backupFile.length() > 0)

        installedModels.deleteRecursively()
        val restored = manager.restoreBackup(Uri.fromFile(backupFile))

        assertEquals(1, restored.modelCount)
        assertEquals(2, restored.fileCount)
        assertArrayEquals(modelBytes, File(installedModels, "embedding-test-v1/model.onnx").readBytes())
        assertArrayEquals(
            tokenizerBytes,
            File(installedModels, "embedding-test-v1/tokenizer/tokenizer.json").readBytes()
        )
    }

    @Test
    fun restoreRefusesToOverwriteAnAlreadyInstalledModel() = runBlocking {
        val modelDirectory = File(installedModels, "embedding-test-v1")
        assertTrue(modelDirectory.mkdirs())
        val original = "original model".toByteArray()
        File(modelDirectory, "weights.bin").writeBytes(original)

        val manager = ModelBackupManager(context)
        manager.exportBackup(Uri.fromFile(backupFile))

        installedModels.deleteRecursively()
        val restoredFile = File(installedModels, "embedding-test-v1/weights.bin")
        assertTrue(restoredFile.parentFile!!.mkdirs())
        restoredFile.writeText("locally installed version")

        val result = runCatching { manager.restoreBackup(Uri.fromFile(backupFile)) }
        assertTrue(result.isFailure)
        assertEquals("locally installed version", restoredFile.readText())
    }
    @Test
    fun backsUpOneModelWithStableIdAndInspectsItBeforeRestore() = runBlocking {
        val embedding = File(installedModels, "embeddinggemma-2-270m")
        val generation = File(installedModels, "qwen3-0.6b-litert")
        assertTrue(embedding.mkdirs())
        assertTrue(generation.mkdirs())
        File(embedding, "weights.bin").writeText("embedding fixture")
        File(generation, "weights.bin").writeText("generation fixture")

        val manager = ModelBackupManager(context)
        val result = manager.exportBackup(Uri.fromFile(backupFile), "embeddinggemma-2-270m")
        assertEquals(1, result.modelCount)
        val preview = manager.inspectBackup(Uri.fromFile(backupFile))
        assertEquals(listOf("embeddinggemma-2-270m"), preview.modelIds)
        assertTrue(preview.labels.first().contains("embedding"))
        assertEquals(1, preview.fileCount)

        installedModels.deleteRecursively()
        manager.restoreBackup(Uri.fromFile(backupFile))
        assertEquals("embedding fixture",
            File(installedModels, "embeddinggemma-2-270m/weights.bin").readText())
        assertTrue(!File(installedModels, "qwen3-0.6b-litert").exists())
    }



    @Test
    fun archiveProgressReportsVerifiedByteTotalAndCanBeCancelled() = runBlocking {
        val model = File(installedModels, "qwen3-0.6b-litert")
        assertTrue(model.mkdirs())
        val bytes = ByteArray(256 * 1024) { (it % 127).toByte() }
        File(model, "weights.bin").writeBytes(bytes)
        val updates = mutableListOf<Pair<Long, Long>>()
        val manager = ModelBackupManager(context)
        manager.exportBackup(Uri.fromFile(backupFile), "qwen3-0.6b-litert") { copied, total ->
            updates.add(copied to total)
        }
        val expected = bytes.size.toLong()
        assertEquals(0L to expected, updates.first())
        assertEquals(expected to expected, updates.last())

        backupFile.delete()
        val cancelled = runCatching {
            manager.exportBackup(Uri.fromFile(backupFile), "qwen3-0.6b-litert") { _, _ ->
                throw CancellationException("User stopped the export")
            }
        }
        assertTrue(cancelled.exceptionOrNull() is CancellationException)
        assertTrue(!backupFile.exists())
    }

}
