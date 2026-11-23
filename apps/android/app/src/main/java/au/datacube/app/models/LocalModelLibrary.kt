package au.datacube.app.models

import android.app.ActivityManager
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.StatFs
import android.provider.OpenableColumns
import java.io.File
import java.security.MessageDigest
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

enum class ModelRole { EMBEDDING, GENERATION }

/** Licensed weights are obtained on the publisher's website, then imported through Android. */
data class ModelSpec(
    val id: String,
    val name: String,
    val role: ModelRole,
    val sourcePage: String,
    val minRamGb: Int,
    val description: String
)

object ModelCatalog {
    val models = listOf(
        ModelSpec(
            "embeddinggemma-300m", "EmbeddingGemma 300M", ModelRole.EMBEDDING,
            "https://huggingface.co/litert-community/embeddinggemma-300m",
            2, "For local document search"
        ),
        ModelSpec(
            "gemma-4-e2b", "Gemma 4 E2B", ModelRole.GENERATION,
            "https://huggingface.co/google/gemma-4-E2B",
            3, "Smaller on-device chat model"
        ),
        ModelSpec(
            "gemma-4-e4b", "Gemma 4 E4B", ModelRole.GENERATION,
            "https://huggingface.co/google/gemma-4-E4B",
            5, "More capable, needs more memory"
        ),
        ModelSpec(
            "qwen3-0.6b-litert", "Qwen3 0.6B", ModelRole.GENERATION,
            "https://huggingface.co/litert-community/Qwen3-0.6B",
            3, "Lightweight model · verified public download"
        )
    )
    fun find(id: String): ModelSpec = requireNotNull(models.firstOrNull { it.id == id })
}

data class DeviceCapability(
    val ramGb: Int,
    val freeStorageGb: Int,
    val architecture: String,
    val recommendedModel: String
)

object DeviceCapabilityScanner {
    fun scan(context: Context): DeviceCapability {
        val memoryInfo = ActivityManager.MemoryInfo()
        (context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager).getMemoryInfo(memoryInfo)
        val freeBytes = StatFs(context.filesDir.path).availableBytes
        val ramGb = (memoryInfo.totalMem / 1_073_741_824L).toInt().coerceAtLeast(1)
        val freeGb = (freeBytes / 1_073_741_824L).toInt().coerceAtLeast(0)
        val recommended = if (ramGb >= 6 && freeGb >= 5) "Gemma 4 E4B"
            else if (ramGb >= 4 && freeGb >= 3) "Gemma 4 E2B"
            else "Search model only"
        return DeviceCapability(
            ramGb, freeGb, Build.SUPPORTED_ABIS.firstOrNull() ?: "Unknown", recommended
        )
    }
}

data class InstalledModel(val id: String, val bytes: Long, val fingerprint: String)

/**
 * Imports downloaded model files without ever writing partial files to the installed folder.
 * SHA-256 hashes are for local corruption detection; publisher authenticity requires a trusted
 * upstream checksum and is not claimed by this importer.
 */
class LocalModelLibrary(private val context: Context) {
    private val root = File(context.filesDir, "models/installed")
    private val stagingRoot = File(context.filesDir, "models/.incoming")
    private val safeName = Regex("^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$")

    fun installed(id: String): Boolean =
        File(root, id).let { it.isDirectory && File(it, "local-manifest.txt").isFile }

    suspend fun install(spec: ModelSpec, uris: List<Uri>): InstalledModel = withContext(Dispatchers.IO) {
        require(uris.isNotEmpty()) { "Choose the model files first." }
        require(uris.size <= 32) { "Choose up to 32 files per model." }
        require(!installed(spec.id)) { "This model is already installed." }
        require(stagingRoot.mkdirs() || stagingRoot.isDirectory)
        val staging = File(stagingRoot, UUID.randomUUID().toString())
        check(staging.mkdir()) { "Cannot prepare model storage." }
        val seen = mutableSetOf<String>()
        var totalBytes = 0L
        val fingerprints = mutableListOf<String>()
        try {
            for (uri in uris) {
                val name = context.contentResolver.query(
                    uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null
                )?.use { cursor ->
                    if (cursor.moveToFirst()) cursor.getString(0) else null
                } ?: "model-" + seen.size + ".bin"
                require(safeName.matches(name) && name != "." && name != "..") {
                    "Unsafe model file name. Rename the file and retry."
                }
                require(seen.add(name)) { "Choose each model file only once." }
                val output = File(staging, name)
                val digest = MessageDigest.getInstance("SHA-256")
                val input = context.contentResolver.openInputStream(uri)
                    ?: error("Cannot open selected model file.")
                input.use { source ->
                    output.outputStream().buffered().use { target ->
                        val buffer = ByteArray(64 * 1024)
                        while (true) {
                            val count = source.read(buffer)
                            if (count < 0) break
                            if (count == 0) continue
                            totalBytes += count
                            require(totalBytes <= 8L * 1024 * 1024 * 1024) {
                                "Selected model exceeds the 8 GB import limit."
                            }
                            digest.update(buffer, 0, count)
                            target.write(buffer, 0, count)
                        }
                    }
                }
                val hash = digest.digest().joinToString("") { "%02x".format(it) }
                fingerprints += name + "\t" + output.length() + "\t" + hash
            }
            require(totalBytes > 0L) { "The selected model files are empty." }
            File(staging, "local-manifest.txt").writeText(fingerprints.joinToString("\n", postfix = "\n"))
            check(root.mkdirs() || root.isDirectory)
            val destination = File(root, spec.id)
            require(!destination.exists()) { "Model directory already exists. No files were replaced." }
            check(staging.renameTo(destination)) { "Could not finalize model files." }
            InstalledModel(spec.id, totalBytes, fingerprints.first().substringAfterLast("\t"))
        } finally {
            if (staging.exists()) staging.deleteRecursively()
        }
    }
}
