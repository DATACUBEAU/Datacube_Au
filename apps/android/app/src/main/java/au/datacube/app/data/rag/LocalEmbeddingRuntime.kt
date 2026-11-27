package au.datacube.app.data.rag

import android.content.Context
import android.os.Build
import au.datacube.app.models.VerifiedModelDownloads
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.retrieval.universalembedder.UniversalEmbedder
import com.google.mediapipe.tasks.retrieval.universalembedder.UniversalEmbedderOptions
import java.io.File
import java.security.MessageDigest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/**
 * Runs EmbeddingGemma 2 on device. This is a real model adapter: no simulated vectors.
 * One engine is retained and serialized to avoid concurrent device memory spikes.
 * A managed Android 9+ runtime is required; older devices retain BM25 search.
 */
object LocalEmbeddingRuntime {
    const val MODEL_ID = "embeddinggemma-2-270m"
    private val mutex = LocalComputeGate.mutex
    private var active: UniversalEmbedder? = null
    private var activePath: String? = null

    fun available(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return false
        val artifact = VerifiedModelDownloads.find(MODEL_ID) ?: return false
        val folder = File(context.filesDir, "models/installed/$MODEL_ID")
        return File(folder, artifact.fileName).isFile
    }

    suspend fun embed(context: Context, text: String): FloatArray = withContext(Dispatchers.IO) {
        require(text.isNotBlank()) { "Cannot embed empty text." }
        require(text.length <= 6_000) { "Text must be chunked before embedding." }
        check(Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            "The selected embedding runtime requires Android 9 or newer."
        }
        mutex.withLock {
            currentCoroutineContext().ensureActive()
            LocalComputeGate.prepare(context, LocalComputeGate.Engine.EMBEDDING)
            val artifact = requireNotNull(VerifiedModelDownloads.find(MODEL_ID))
            val model = File(context.filesDir, "models/installed/$MODEL_ID/${artifact.fileName}")
            check(model.isFile) { "Download the EmbeddingGemma 2 search model first." }
            if (activePath != model.absolutePath || active == null) {
                active?.close()
                active = null
                // Check the full publisher digest when loading, even if files were imported manually.
                val actual = sha256(model)
                check(actual == artifact.sha256) {
                    "Search model failed publisher checksum verification. Re-download it."
                }
                val options = UniversalEmbedderOptions.builder()
                    .setBaseOptions(
                        BaseOptions.builder().setModelAssetPath(model.absolutePath).build()
                    )
                    .setL2Normalize(true)
                    .build()
                active = UniversalEmbedder.createFromOptions(context.applicationContext, options)
                activePath = model.absolutePath
            }
            val vector = checkNotNull(active).embedText(text).embeddings().firstOrNull()
                ?.floatEmbedding()?.copyOf() ?: error("Embedding model returned no vector.")
            require(vector.size in 128..4096 && vector.all { it.isFinite() }) {
                "Embedding output is invalid."
            }
            vector
        }
    }

    private suspend fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().buffered().use { input ->
            val buffer = ByteArray(128 * 1024)
            while (true) {
                currentCoroutineContext().ensureActive()
                val n = input.read(buffer)
                if (n < 0) break
                if (n > 0) digest.update(buffer, 0, n)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    suspend fun close() = mutex.withLock { closeAdmitted() }

    internal fun closeAdmitted() {
        active?.close()
        active = null
        activePath = null
    }
}
