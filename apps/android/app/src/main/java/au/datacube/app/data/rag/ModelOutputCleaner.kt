package au.datacube.app.data.rag

/** User-visible output only. Activity indicators report actual application actions. */
object ModelOutputCleaner {
    private val completedThought = Regex("""(?is)<(think|thinking|analysis|reasoning)\s*>.*?</\1\s*>""")
    private val unfinishedThought = Regex("""(?is)<(?:think|thinking|analysis|reasoning)(?:\s|>|$).*""")
    private val citations = Regex("""\[(\d{1,3})\]""")
    private val hiddenTags = listOf("<think", "<thinking", "<analysis", "<reasoning")

    fun visible(raw: String, sourceCount: Int): String {
        var displayed = raw.replace(completedThought, "").replace(unfinishedThought, "")
        // Streaming may end halfway through the opening tag.
        val tail = displayed.substringAfterLast('<', "")
        if (tail.isNotEmpty() && hiddenTags.any { it.startsWith("<" + tail.lowercase()) }) {
            displayed = displayed.substringBeforeLast('<')
        }
        displayed = citations.replace(displayed) { match ->
            val n = match.groupValues[1].toIntOrNull() ?: 0
            if (n in 1..sourceCount) match.value else ""
        }
        return displayed.take(12_000)
    }
}
