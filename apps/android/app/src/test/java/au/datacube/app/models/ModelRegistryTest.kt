package au.datacube.app.models

import java.io.File
import java.security.MessageDigest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class ModelRegistryTest {
    @get:Rule
    val temporaryFolder = TemporaryFolder()

    @Test
    fun installsOnlyExactVerifiedArtifactSetAndPersistsManifest() {
        val registry = ModelRegistry(temporaryFolder.newFolder("app-files"))
        val staging = registry.createStagingDirectory("e5-small")
        val modelBytes = "verified local embedding model fixture".toByteArray()
        val modelFile = registry.createStagingFile(staging, "onnx/model.onnx")
        modelFile.writeBytes(modelBytes)

        val installed = registry.install(
            staging,
            manifest(
                id = "e5-small",
                files = listOf(artifact("onnx/model.onnx", modelBytes))
            )
        )

        assertEquals("e5-small", installed.modelId)
        assertEquals(1, installed.manifest?.artifacts?.size)
        assertEquals("intfloat/multilingual-e5-small", installed.manifest?.sourceRepository)
        assertEquals(modelBytes.size.toLong() + File(installed.directory, ModelRegistry.MANIFEST_FILE).length(), installed.totalBytes)
        assertFalse(staging.exists())

        val reloaded = registry.findInstalled("e5-small")
        assertNotNull(reloaded)
        assertEquals("MIT", reloaded?.manifest?.licenseId)
        assertEquals("main", reloaded?.manifest?.sourceRevision)
        assertEquals(1, registry.listInstalled().size)

        registry.validateStagedDirectory(installed.directory, "e5-small")
        File(installed.directory, "onnx/model.onnx").writeText("tampered after installation")
        assertThrows(IllegalArgumentException::class.java) {
            registry.validateStagedDirectory(installed.directory, "e5-small")
        }
    }

    @Test
    fun refusesArtifactWithIncorrectChecksumAndKeepsItOutOfInstalledModels() {
        val registry = ModelRegistry(temporaryFolder.newFolder("app-files"))
        val staging = registry.createStagingDirectory("bad-model")
        val bytes = "not the expected file".toByteArray()
        registry.createStagingFile(staging, "model.onnx").writeBytes(bytes)

        val invalid = manifest(
            id = "bad-model",
            files = listOf(ModelArtifactRecord("model.onnx", bytes.size.toLong(), "0".repeat(64)))
        )
        assertThrows(IllegalArgumentException::class.java) {
            registry.install(staging, invalid)
        }
        assertTrue(staging.exists())
        assertNull(registry.findInstalled("bad-model"))
    }

    @Test
    fun rejectsPathTraversalInStagingFileCreation() {
        val registry = ModelRegistry(temporaryFolder.newFolder("app-files"))
        val staging = registry.createStagingDirectory("safe-model")
        assertThrows(IllegalArgumentException::class.java) {
            registry.createStagingFile(staging, "../outside.bin")
        }
    }

    private fun manifest(id: String, files: List<ModelArtifactRecord>) = ModelInstallManifest(
        modelId = id,
        displayName = "Test model",
        task = "embedding",
        sourceRepository = "intfloat/multilingual-e5-small",
        sourceRevision = "main",
        licenseId = "MIT",
        licenseUrl = "https://opensource.org/license/mit",
        runtime = "onnxruntime",
        modelFormat = "ONNX",
        quantization = "FP32",
        minimumRamMb = 1024,
        contextLength = 512,
        installedAtEpochMs = 1_700_000_000_000L,
        artifacts = files
    )

    private fun artifact(path: String, bytes: ByteArray): ModelArtifactRecord =
        ModelArtifactRecord(
            path = path,
            sizeBytes = bytes.size.toLong(),
            sha256 = MessageDigest.getInstance("SHA-256")
                .digest(bytes)
                .joinToString("") { "%02x".format(it) }
        )
}
