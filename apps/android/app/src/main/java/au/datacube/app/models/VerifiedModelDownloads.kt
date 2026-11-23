package au.datacube.app.models

/**
 * Downloads are enabled only for explicitly reviewed artifacts with immutable source
 * revisions and publisher-supplied SHA-256 hashes. Do not accept an arbitrary URL
 * or a hash fetched from the same untrusted redirect as the model bytes.
 */
data class VerifiedModelArtifact(
    val modelId: String,
    val fileName: String,
    val url: String,
    val sha256: String,
    val maximumBytes: Long,
    val displaySize: String,
    val license: String
) {
    init {
        require(modelId.matches(Regex("[a-z0-9][a-z0-9._-]{1,80}")))
        require(fileName.matches(Regex("[A-Za-z0-9][A-Za-z0-9._-]{1,119}")))
        require(sha256.matches(Regex("[a-f0-9]{64}")))
        require(maximumBytes in 1L..(8L * 1024 * 1024 * 1024))
        require(url.startsWith("https://huggingface.co/"))
        require(!url.contains("..") && !url.contains('?') && !url.contains('#'))
    }
}

object VerifiedModelDownloads {
    /**
     * Public Apache 2.0 LiteRT-LM model. Revision, filename and SHA-256 were
     * checked against the Hugging Face upstream file page on 2026-11-23.
     * This establishes byte integrity, NOT Android runtime compatibility.
     */
    private val qwen3Small = VerifiedModelArtifact(
        modelId = "qwen3-0.6b-litert",
        fileName = "Qwen3-0.6B.litertlm",
        url = "https://huggingface.co/litert-community/Qwen3-0.6B/resolve/e6687177e00897731e7716267eebd4eba0dde7c2/Qwen3-0.6B.litertlm",
        sha256 = "c5f39b4191926786c3e6668b62af4d6eb15248dfc7a5348252a9b406f33f2108",
        maximumBytes = 800L * 1024 * 1024,
        displaySize = "About 614 MB",
        license = "Apache-2.0"
    )

    /**
     * Public Apache-2.0 EmbeddingGemma 2 text model, official LiteRT community export.
     * Pinned upstream commit and SHA-256 from Hugging Face LFS pointer (2026-11-23).
     */
    private val embeddingGemma2 = VerifiedModelArtifact(
        modelId = "embeddinggemma-2-270m",
        fileName = "embeddinggemma-2-text-270m.litertlm",
        url = "https://huggingface.co/litert-community/embeddinggemma-2-text-270m-litert-lm/resolve/9be6e8b90982095dc05c2bd162e4b954ee4dbac7/embeddinggemma-2-text-270m.litertlm",
        sha256 = "2d079ee2f6f066b1f368e8d7c819f55214eaef1d0513b312321901f30ab286fb",
        maximumBytes = 220L * 1024 * 1024,
        displaySize = "About 165 MB",
        license = "Apache-2.0"
    )

    /**
     * Official LiteRT Community CPU-compatible Gemma 4 exports.
     * SHA-256 values are taken from the pinned Hugging Face Xet pointer pages.
     * Files are Apache-2.0 and ungated; real device RAM/performance varies.
     */
    private val gemma4E2B = VerifiedModelArtifact(
        modelId = "gemma-4-e2b",
        fileName = "gemma-4-E2B-it.litertlm",
        url = "https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/95d108359598714b42933b5efff29987823e688b/gemma-4-E2B-it.litertlm",
        sha256 = "ab7838cdfc8f77e54d8ca45eadceb20452d9f01e4bfade03e5dce27911b27e42",
        maximumBytes = 3_000_000_000L,
        displaySize = "2.58 GB",
        license = "Apache-2.0"
    )

    private val gemma4E4B = VerifiedModelArtifact(
        modelId = "gemma-4-e4b",
        fileName = "gemma-4-E4B-it.litertlm",
        url = "https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm/resolve/28299f30ee4d43294517a4ac93abd6163412f07f/gemma-4-E4B-it.litertlm",
        sha256 = "0b2a8980ce155fd97673d8e820b4d29d9c7d99b8fa6806f425d969b145bd52e0",
        maximumBytes = 4_000_000_000L,
        displaySize = "3.66 GB",
        license = "Apache-2.0"
    )

    /** Older EmbeddingGemma v1 remains publisher/import only. */

    fun find(modelId: String): VerifiedModelArtifact? =
        when (modelId) {
            qwen3Small.modelId -> qwen3Small
            embeddingGemma2.modelId -> embeddingGemma2
            gemma4E2B.modelId -> gemma4E2B
            gemma4E4B.modelId -> gemma4E4B
            else -> null
        }
}
