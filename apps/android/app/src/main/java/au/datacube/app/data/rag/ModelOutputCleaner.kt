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

    private val visualTags = listOf("DIAGRAM", "SKETCH", "WORKFLOW", "FLOW", "BOX", "BAR", "PIE", "FORMULA", "STEPS")
    private val openVisual = Regex("""^\[(DIAGRAM|SKETCH|WORKFLOW|FLOW|BOX|BAR|PIE|FORMULA|STEPS)](?:\s.*)?$""")
    private val partialCitation = Regex("""\[\d{0,3}$""")
    /** Hold incomplete native visual blocks and unfinished formatting markers.
     * Complete code fences are handled separately; never hide literal code. */
    fun streamingVisible(raw: String, sourceCount: Int): String {
        val cleaned = visible(raw, sourceCount)
        val lines = cleaned.split('\n')
        val output = mutableListOf<String>()
        val pending = mutableListOf<String>()
        val stack = mutableListOf<String>()
        var code = false
        for ((index, line) in lines.withIndex()) {
            val trimmed = line.trim()
            if (stack.isEmpty() && trimmed.startsWith("\u0060\u0060\u0060")) {
                code = !code
                output += line
                continue
            }
            if (code) { output += line; continue }
            val opening = openVisual.matchEntire(trimmed)?.groupValues?.get(1)
            if (opening != null && trimmed != "[DIAGRAM] projectile") {
                stack += opening
                pending += line
                continue
            }
            if (stack.isNotEmpty()) {
                pending += line
                if (trimmed == "[/" + stack.last() + "]") stack.removeAt(stack.lastIndex)
                if (stack.isEmpty()) { output += pending; pending.clear() }
                continue
            }
            if (index == lines.lastIndex) {
                if (trimmed.isNotEmpty() && (visualTags.any { ("[" + it + "]").startsWith(trimmed) } ||
                    trimmed.matches(Regex("""#{1,6}\s*|[-*]\s*|\d+[.)]\s*""")))) continue
                output += line.replace(partialCitation, "")
            } else output += line
        }
        return output.joinToString("\n")
    }

}
