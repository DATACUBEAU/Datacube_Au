package au.datacube.app.data.rag

/** One registry for streaming, rendering and general-answer visual completion. */
internal object AuVisualProtocol {
    val blockTags = listOf("DIAGRAM","SKETCH","WORKFLOW","FLOW","BOX","BAR","PIE","FORMULA","TREE","STEPS","MAP","PLOT","SCATTER","TIMELINE")
    val singleTags = listOf("SCIENCE","SIM")
    val visualTags = blockTags + singleTags
    private val alternatives = blockTags.joinToString("|")
    val open = Regex("^\\[(" + alternatives + ")](?:\\s.*)?$")
    val blockMarker = Regex("^\\[(" + alternatives + ")](?:.*)$")
    val marker = Regex("^\\[/?(?:" + (visualTags + "STEP").joinToString("|") + ")](?:.*)$")
    private val hasVisualOrFence = Regex("(?im)^\\s*(?:\\[(?:" + visualTags.joinToString("|") + ")]|\\x60\\x60\\x60)")
    private val refusal = Regex("(?i)\\b(?:cannot help|can't help|unable to answer|could not answer|cannot answer|can't answer|not enough information|insufficient information)\\b")

    fun missingDirective(answer: String, tag: String, key: String): String? {
        require(tag in singleTags)
        val visible = ModelOutputCleaner.visible(answer,0).trim()
        if (visible.length < 20 || answer.length > 11_800 ||
            hasVisualOrFence.containsMatchIn(visible) || refusal.containsMatchIn(visible)) return null
        return "\n\n[" + tag + "] " + key
    }
}
