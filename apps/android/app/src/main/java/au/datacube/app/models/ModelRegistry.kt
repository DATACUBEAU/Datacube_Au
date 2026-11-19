package au.datacube.app.models

import android.content.Context
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.security.MessageDigest
import java.util.Base64
import java.util.Properties
import java.util.UUID

data class ModelArtifactRecord(
    val path: String,
    val sizeBytes: Long,
    val sha256: String
)

data class ModelInstallManifest(
    val modelId: String,
    val displayName: String,
    val task: String,
    val sourceRepository: String,
    val sourceRevision: String,
    val licenseId: String,
    val licenseUrl: String?,
    val runtime: String,
    val modelFormat: String,
    val quantization: String?,
    val minimumRamMb: Int,
    val contextLength: Int?,
    val installedAtEpochMs: Long,
    val artifacts: List<ModelArtifactRecord>
)

data class InstalledModelRecord(
    val modelId: String,
    val directory: File,
    val totalBytes: Long,
    val fileCount: Int,
    val manifest: ModelInstallManifest?
)

/**
 * Local model registry and atomic installation boundary.
 *
 * Downloaders write only to a staging directory returned by createStagingDirectory().
 * install() validates the exact artifact set and checksums before atomically moving the
 * complete model directory into filesDir/models/installed/<model-id>/.
 *
 * The .datacube-model.properties file contains descriptive metadata only. It is never
 * interpreted as executable code. It is included in external model backups automatically.
 */
class ModelRegistry internal constructor(private val filesDir: File) {
    constructor(context: Context) : this(context.filesDir)

    private val modelsRoot = File(filesDir, "models/installed")
    private val downloadsRoot = File(filesDir, "models/downloads")

    fun createStagingDirectory(modelId: String): File {
        validateModelId(modelId)
        if (!downloadsRoot.exists() && !downloadsRoot.mkdirs()) {
            error("Could not create model download storage.")
        }
        val staging = File(downloadsRoot, "$modelId-${UUID.randomUUID()}")
        require(staging.mkdirs()) { "Could not create temporary model storage." }
        return staging
    }

    fun install(stagingDirectory: File, manifest: ModelInstallManifest): InstalledModelRecord {
        validateManifest(manifest)
        val staging = stagingDirectory.canonicalFile
        val downloads = downloadsRoot.canonicalFile
        require(staging.path.startsWith(downloads.path + File.separator)) {
            "Model installation staging must be inside DataCube AU's download storage."
        }
        require(staging.isDirectory && !isSymlink(staging)) {
            "The model download is not a safe staging directory."
        }

        val expectedPaths = manifest.artifacts.map { it.path }.toSet()
        val actualFiles = staging.walkTopDown()
            .filter { it.isFile && !isSymlink(it) }
            .map { file -> relativePath(staging, file) }
            .toSet()
        require(actualFiles == expectedPaths) {
            "The downloaded model files do not match the approved artifact manifest."
        }

        manifest.artifacts.forEach { artifact ->
            val artifactFile = resolveInside(staging, artifact.path)
            val digest = digestFile(artifactFile)
            require(digest.first == artifact.sizeBytes) {
                "Model file size verification failed for ${artifact.path}."
            }
            require(digest.second.equals(artifact.sha256, ignoreCase = true)) {
                "Model file checksum verification failed for ${artifact.path}."
            }
        }

        if (!modelsRoot.exists() && !modelsRoot.mkdirs()) {
            error("Could not create installed model storage.")
        }
        val destination = File(modelsRoot, manifest.modelId)
        require(!destination.exists()) {
            "Model '${manifest.modelId}' is already installed. Remove it before replacing it."
        }

        writeManifest(staging, manifest)
        require(staging.renameTo(destination)) {
            "Could not atomically install the verified model."
        }
        return inspectInstalledDirectory(destination)
    }

    fun listInstalled(): List<InstalledModelRecord> {
        if (!modelsRoot.exists()) return emptyList()
        val root = modelsRoot.canonicalFile
        return modelsRoot.listFiles()
            .orEmpty()
            .filter { dir ->
                dir.isDirectory && MODEL_ID.matches(dir.name) && !isSymlink(dir)
            }
            .mapNotNull { dir ->
                val canonical = dir.canonicalFile
                if (!canonical.path.startsWith(root.path + File.separator)) null
                else inspectInstalledDirectory(canonical)
            }
            .sortedBy { it.modelId }
    }

    fun findInstalled(modelId: String): InstalledModelRecord? {
        validateModelId(modelId)
        val directory = File(modelsRoot, modelId)
        if (!directory.isDirectory || isSymlink(directory)) return null
        return inspectInstalledDirectory(directory.canonicalFile)
    }

    fun createStagingFile(stagingDirectory: File, relativePath: String): File {
        val staging = stagingDirectory.canonicalFile
        val downloads = downloadsRoot.canonicalFile
        require(staging.path.startsWith(downloads.path + File.separator)) {
            "Download staging is outside the approved model storage."
        }
        val file = resolveInside(staging, relativePath)
        file.parentFile?.let { parent ->
            if (!parent.exists() && !parent.mkdirs()) error("Could not create model artifact directory.")
        }
        return file
    }

    fun discardStagingDirectory(stagingDirectory: File) {
        val staging = stagingDirectory.canonicalFile
        val downloads = downloadsRoot.canonicalFile
        require(staging.path.startsWith(downloads.path + File.separator)) {
            "Refusing to delete a directory outside model download storage."
        }
        staging.deleteRecursively()
    }

    private fun inspectInstalledDirectory(directory: File): InstalledModelRecord {
        val files = directory.walkTopDown()
            .filter { it.isFile && !isSymlink(it) }
            .toList()
        val metadata = File(directory, MANIFEST_FILE)
        val manifest = if (metadata.isFile && !isSymlink(metadata)) {
            runCatching { readManifest(metadata) }.getOrNull()
        } else {
            null
        }
        return InstalledModelRecord(
            modelId = directory.name,
            directory = directory,
            totalBytes = files.sumOf { it.length() },
            fileCount = files.size,
            manifest = manifest
        )
    }

    private fun validateManifest(manifest: ModelInstallManifest) {
        validateModelId(manifest.modelId)
        require(manifest.displayName.isNotBlank() && manifest.displayName.length <= 200)
        require(manifest.task.isNotBlank() && manifest.task.length <= 80)
        require(manifest.sourceRepository.matches(REPOSITORY_ID))
        require(manifest.sourceRevision.isNotBlank() && manifest.sourceRevision.length <= 160)
        require(manifest.licenseId.isNotBlank() && manifest.licenseId.length <= 120)
        require(manifest.licenseUrl == null || manifest.licenseUrl.startsWith("https://"))
        require(manifest.runtime.isNotBlank() && manifest.runtime.length <= 80)
        require(manifest.modelFormat.isNotBlank() && manifest.modelFormat.length <= 80)
        require(manifest.quantization == null || manifest.quantization.length <= 80)
        require(manifest.minimumRamMb >= 0)
        require(manifest.contextLength == null || manifest.contextLength > 0)
        require(manifest.installedAtEpochMs > 0)
        require(manifest.artifacts.isNotEmpty() && manifest.artifacts.size <= MAX_ARTIFACTS)
        require(manifest.artifacts.map { it.path }.distinct().size == manifest.artifacts.size)
        manifest.artifacts.forEach { artifact ->
            validateRelativePath(artifact.path)
            require(artifact.sizeBytes >= 0 && artifact.sizeBytes <= MAX_ARTIFACT_BYTES)
            require(SHA256.matches(artifact.sha256.lowercase()))
        }
    }

    private fun writeManifest(directory: File, manifest: ModelInstallManifest) {
        val properties = Properties().apply {
            setProperty("schemaVersion", "1")
            setEncoded("modelId", manifest.modelId)
            setEncoded("displayName", manifest.displayName)
            setEncoded("task", manifest.task)
            setEncoded("sourceRepository", manifest.sourceRepository)
            setEncoded("sourceRevision", manifest.sourceRevision)
            setEncoded("licenseId", manifest.licenseId)
            setEncoded("licenseUrl", manifest.licenseUrl.orEmpty())
            setEncoded("runtime", manifest.runtime)
            setEncoded("modelFormat", manifest.modelFormat)
            setEncoded("quantization", manifest.quantization.orEmpty())
            setProperty("minimumRamMb", manifest.minimumRamMb.toString())
            setProperty("contextLength", manifest.contextLength?.toString().orEmpty())
            setProperty("installedAtEpochMs", manifest.installedAtEpochMs.toString())
            setProperty("artifactCount", manifest.artifacts.size.toString())
            manifest.artifacts.forEachIndexed { index, artifact ->
                val prefix = "artifact.$index."
                setEncoded(prefix + "path", artifact.path)
                setProperty(prefix + "sizeBytes", artifact.sizeBytes.toString())
                setProperty(prefix + "sha256", artifact.sha256.lowercase())
            }
        }
        val temporary = File(directory, "$MANIFEST_FILE.tmp")
        FileOutputStream(temporary).use { properties.store(it, "DataCube AU local model metadata") }
        val target = File(directory, MANIFEST_FILE)
        require(temporary.renameTo(target)) { "Could not write the installed model manifest." }
    }

    private fun readManifest(file: File): ModelInstallManifest {
        val properties = Properties()
        FileInputStream(file).use(properties::load)
        require(properties.getProperty("schemaVersion") == "1") {
            "Unsupported installed model metadata version."
        }
        val count = properties.getProperty("artifactCount")?.toIntOrNull()
            ?: error("Installed model metadata has an invalid artifact count.")
        require(count in 1..MAX_ARTIFACTS)
        val artifacts = (0 until count).map { index ->
            val prefix = "artifact.$index."
            ModelArtifactRecord(
                path = properties.getEncoded(prefix + "path"),
                sizeBytes = properties.getProperty(prefix + "sizeBytes")?.toLongOrNull()
                    ?: error("Installed model metadata has an invalid artifact size."),
                sha256 = properties.getProperty(prefix + "sha256").orEmpty()
            )
        }
        return ModelInstallManifest(
            modelId = properties.getEncoded("modelId"),
            displayName = properties.getEncoded("displayName"),
            task = properties.getEncoded("task"),
            sourceRepository = properties.getEncoded("sourceRepository"),
            sourceRevision = properties.getEncoded("sourceRevision"),
            licenseId = properties.getEncoded("licenseId"),
            licenseUrl = properties.getEncoded("licenseUrl").ifEmpty { null },
            runtime = properties.getEncoded("runtime"),
            modelFormat = properties.getEncoded("modelFormat"),
            quantization = properties.getEncoded("quantization").ifEmpty { null },
            minimumRamMb = properties.getProperty("minimumRamMb")?.toIntOrNull()
                ?: error("Installed model metadata has an invalid RAM requirement."),
            contextLength = properties.getProperty("contextLength")?.toIntOrNull(),
            installedAtEpochMs = properties.getProperty("installedAtEpochMs")?.toLongOrNull()
                ?: error("Installed model metadata has an invalid install date."),
            artifacts = artifacts
        ).also(::validateManifest)
    }

    private fun Properties.setEncoded(key: String, value: String) {
        setProperty(key, Base64.getUrlEncoder().withoutPadding().encodeToString(value.toByteArray(Charsets.UTF_8)))
    }

    private fun Properties.getEncoded(key: String): String {
        val value = getProperty(key) ?: error("Installed model metadata is missing '$key'.")
        return try {
            String(Base64.getUrlDecoder().decode(value), Charsets.UTF_8)
        } catch (_: IllegalArgumentException) {
            error("Installed model metadata contains invalid encoded text.")
        }
    }

    private fun digestFile(file: File): Pair<Long, String> {
        val digest = MessageDigest.getInstance("SHA-256")
        var size = 0L
        FileInputStream(file).buffered().use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                size += count
                require(size <= MAX_ARTIFACT_BYTES)
                digest.update(buffer, 0, count)
            }
        }
        return size to digest.digest().toHex()
    }

    private fun relativePath(root: File, file: File): String {
        val base = root.canonicalPath + File.separator
        val path = file.canonicalPath
        require(path.startsWith(base))
        return path.substring(base.length).replace(File.separatorChar, '/')
    }

    private fun resolveInside(root: File, path: String): File {
        validateRelativePath(path)
        val target = File(root, path).canonicalFile
        require(target.path.startsWith(root.canonicalPath + File.separator)) {
            "Model artifact path escapes its model directory."
        }
        return target
    }

    private fun validateModelId(modelId: String) {
        require(MODEL_ID.matches(modelId)) { "Invalid model identifier." }
    }

    private fun validateRelativePath(path: String) {
        require(path.isNotBlank() && path.length <= MAX_PATH_LENGTH)
        require(!path.startsWith('/') && !path.contains('\\'))
        require(path.split('/').all { part ->
            part.isNotBlank() && part != "." && part != ".." &&
                part.none { it.code < 0x20 || it.code == 0x7f }
        }) { "Unsafe model artifact path." }
    }

    private fun isSymlink(file: File): Boolean =
        java.nio.file.Files.isSymbolicLink(file.toPath())

    private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }

    companion object {
        const val MANIFEST_FILE = ".datacube-model.properties"
        private const val MAX_ARTIFACTS = 10_000
        private const val MAX_ARTIFACT_BYTES = 20L * 1024 * 1024 * 1024
        private const val MAX_PATH_LENGTH = 2048
        private val MODEL_ID = Regex("^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
        private val REPOSITORY_ID = Regex("^[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9][A-Za-z0-9._-]*$")
        private val SHA256 = Regex("^[a-f0-9]{64}$")
    }
}
