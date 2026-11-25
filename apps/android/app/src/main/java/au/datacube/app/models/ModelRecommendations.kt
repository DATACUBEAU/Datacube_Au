package au.datacube.app.models

import android.content.Context

/** Recommendations are advisory only. Never queue a download or request storage access. */
object ModelRecommendations {
    fun bestChatModel(ramGb: Int, freeStorageGb: Int): String? = when {
        ramGb >= 8 && freeStorageGb >= 9 -> "gemma-4-e4b"
        ramGb >= 6 && freeStorageGb >= 6 -> "gemma-4-e2b"
        ramGb >= 3 && freeStorageGb >= 3 -> "qwen3-0.6b-litert"
        else -> null
    }
    fun bestSearchModel(): String = "embeddinggemma-2-270m"

    data class SetupPlan(val chat: String?, val search: String?, val voice: String?)
    /** Advisory, conservative combined budget: download plus backup, with room for documents. */
    fun setupPlan(ramGb: Int, freeStorageGb: Int, sdk: Int, arm64: Boolean,
                  installed: Set<String> = emptySet()): SetupPlan {
        if (!arm64 || sdk < 26) return SetupPlan(null,null,null)
        val gib = 1024L * 1024 * 1024
        var remaining = (freeStorageGb.toLong().coerceAtLeast(0) - 1).coerceAtLeast(0) * gib
        fun cost(id: String) = if (id in installed) 0L else
            (VerifiedModelDownloads.find(id)?.maximumBytes ?: Long.MAX_VALUE / 2) * 2
        val search = bestSearchModel().takeIf { sdk >= 28 && compatible(it,ramGb) && cost(it) <= remaining }
        if (search != null) remaining -= cost(search)
        val chat = listOf("gemma-4-e4b","gemma-4-e2b","qwen3-0.6b-litert")
            .filter { compatible(it,ramGb) && cost(it) <= remaining }
            .let { eligible -> eligible.firstOrNull { it in installed } ?: eligible.firstOrNull() }
        if (chat != null) remaining -= cost(chat)
        val voice = "kokoro-82m-cpu".takeIf { sdk >= 28 && compatible(it,ramGb) &&
            chat != null && cost(it) <= remaining }
        return SetupPlan(chat,search,voice)
    }

    fun recommendedFor(context: Context): String? {
        val device = DeviceCapabilityScanner.scan(context)
        return bestChatModel(device.ramGb, device.freeStorageGb)
    }

    fun compatible(id: String, ramGb: Int): Boolean {
        val spec = ModelCatalog.models.firstOrNull { it.id == id } ?: return false
        return ramGb >= spec.minRamGb
    }
}

/** Select ONE installed chat model; changing selection never starts a download. */
class ActiveLocalChatModel(context: Context) {
    private val app = context.applicationContext
    private val prefs = app.getSharedPreferences("datacube_chat_model_selection", Context.MODE_PRIVATE)
    private val library = LocalModelLibrary(app)

    fun selected(): String? {
        val chosen = prefs.getString("selected_id", null)
        if (chosen != null && verifiedInstalled(chosen)) return chosen
        // Prefer the device recommendation only when its verified files exist.
        val recommended = ModelRecommendations.recommendedFor(app)
        if (recommended != null && verifiedInstalled(recommended)) return recommended
        return listOf("qwen3-0.6b-litert", "gemma-4-e2b", "gemma-4-e4b")
            .firstOrNull(::verifiedInstalled)
    }

    fun setSelected(modelId: String) {
        require(verifiedInstalled(modelId)) {
            "Install a verified compatible chat model before selecting it."
        }
        check(prefs.edit().putString("selected_id", modelId).commit()) {
            "Could not save the active model."
        }
    }

    private fun verifiedInstalled(id: String): Boolean =
        ModelCatalog.models.any { it.id == id && it.role == ModelRole.GENERATION } &&
            VerifiedModelDownloads.find(id) != null && library.installed(id)
}
