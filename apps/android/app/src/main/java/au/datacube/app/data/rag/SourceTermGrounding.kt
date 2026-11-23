package au.datacube.app.data.rag

data class TermContext(val term: String, val excerpt: String, val page: Int?)

/** Finds an actual source passage for a tapped word; never invents a definition. */
object SourceTermGrounding {
    private val tokens = Regex("""[\p{L}][\p{L}\p{N}_'-]*""")

    fun wordAt(text: String, offset: Int): String? {
        if (offset !in text.indices) return null
        val match = tokens.findAll(text).firstOrNull { offset in it.range } ?: return null
        return match.value.takeIf { it.length in 3..42 }
    }

    fun find(term: String, excerpts: List<RagEvidence>): TermContext? {
        if (term.isBlank() || term.length > 42) return null
        val expression = Regex("""(?<![\p{L}\p{N}])""" + Regex.escape(term) + """(?![\p{L}\p{N}])""",
            RegexOption.IGNORE_CASE)
        for (source in excerpts) {
            val matched = expression.find(source.text) ?: continue
            val left = source.text.lastIndexOfAny(charArrayOf('.', '\n', '?', '!'), matched.range.first - 1)
            val rightCandidates = listOf('.', '\n', '?', '!').map {
                source.text.indexOf(it, matched.range.last + 1)
            }.filter { it >= 0 }
            val right = rightCandidates.minOrNull()?.plus(1) ?: source.text.length
            val sentence = source.text.substring((left + 1).coerceAtLeast(0), right)
                .trim().take(900)
            return TermContext(term, sentence.ifBlank { source.text.take(900) }, source.page)
        }
        return null
    }
}
