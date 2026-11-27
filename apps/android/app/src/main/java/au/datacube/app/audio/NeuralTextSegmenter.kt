package au.datacube.app.audio

/** Boundaries are chosen for speech, not arbitrary character counts. */
object NeuralTextSegmenter {
    data class Segment(val text: String, val pauseAfterMs: Int)
    private val paragraphBreak = Regex("""\r?\n[ \t]*\r?\n+""")
    private val whitespace = Regex("""\s+""")
    private val abbreviation = Regex("""(?i)(?:\b(?:mr|mrs|ms|dr|prof|sr|jr|st|vs|etc|e\.g|i\.e)|\b[A-Z])\.$""")

    fun split(input: String, maxChunk: Int = 260, maxText: Int = 2200): List<String> =
        plan(input, maxChunk, maxText).map { it.text }

    fun plan(input: String, maxChunk: Int = 260, maxText: Int = 2200): List<Segment> {
        require(maxChunk in 100..1000)
        require(maxText in maxChunk..12000)
        require(input.length <= 128_000) { "Narration is too long for one session." }
        val paragraphs = input.split(paragraphBreak).map { it.replace(whitespace, " ").trim() }
            .filter { it.isNotEmpty() }
        val result = mutableListOf<Segment>()
        paragraphs.forEachIndexed { paragraphIndex, normalized ->
            var offset = 0
            while (offset < normalized.length) {
                val maxEnd = minOf(offset + maxChunk, normalized.length)
                val cut = if (maxEnd == normalized.length) maxEnd else {
                    val spaces = (offset + 1..maxEnd).filter { normalized.getOrNull(it) == ' ' }
                    val sentence = spaces.lastOrNull { sentenceEnd(normalized, offset, it) }
                    val clause = spaces.lastOrNull { normalized[it - 1] in ",;:" }
                    // A short complete sentence is preferable to splitting a word.
                    // Only an exceptional unbroken token may need a hard boundary.
                    val boundary = sentence ?: clause?.takeIf { it - offset >= maxChunk / 3 }
                        ?: spaces.lastOrNull() ?: maxEnd
                    if (boundary < normalized.length && normalized[boundary - 1].isHighSurrogate()) boundary - 1
                    else boundary
                }
                val text = normalized.substring(offset, cut).trim()
                if (text.isNotEmpty()) {
                    val pause = when {
                        cut == normalized.length && paragraphIndex < paragraphs.lastIndex -> 420
                        sentenceEnd(normalized, offset, cut) -> 260
                        text.last() in ",;:" -> 140
                        else -> 0
                    }
                    result += Segment(text, pause)
                }
                offset = cut
                while (offset < normalized.length && normalized[offset] == ' ') offset++
            }
        }
        return result
    }

    private fun sentenceEnd(value: String, start: Int, end: Int): Boolean {
        val prefix = value.substring(start, end).trimEnd('"', '\'', '”', '’', ')', ']')
        if (prefix.isEmpty()) return false
        if (prefix.last() in "!?") return true
        if (prefix.last() != '.') return false
        return !abbreviation.containsMatchIn(prefix.takeLast(20))
    }
}
