package au.datacube.app.data.rag

/**
 * Produces user-facing text, omitting Qwen-style private thinking tags.
 * The UI's "Search activity" separately shows actual retrieval operations.
 */
object ModelOutputCleaner {
    private val completedThought = Regex("""(?s)<think>.*?</think>""")
    private val citations = Regex("""\[(\d{1,2})\]""")

    fun visible(raw: String, sourceCount: Int): String {
        var displayed = raw.replace(completedThought, "")
        val unfinishedThought = displayed.indexOf("<think>")
        if (unfinishedThought >= 0) displayed = displayed.take(unfinishedThought)
        val partialTag = displayed.indexOf("<thin")
        if (partialTag >= 0) displayed = displayed.take(partialTag)
        displayed = citations.replace(displayed) { match ->
            val n = match.groupValues[1].toIntOrNull() ?: 0
            if (n in 1..sourceCount) match.value else ""
        }
        return displayed.take(12_000)
    }
}
