package au.datacube.app.data.rag

/** User-visible output only. Activity indicators report actual application actions. */
object ModelOutputCleaner {
    private val completedThought = Regex("""(?is)<(think|thinking|analysis|reasoning)\s*>.*?</\1\s*>""")
    private val unfinishedThought = Regex("""(?is)<(?:think|thinking|analysis|reasoning)(?:\s|>|$).*""")
    private val citations = Regex("""\[(\d{1,3})\]""")
    private val hiddenTags = listOf("<think", "<thinking", "<analysis", "<reasoning")

    fun visible(raw: String, sourceCount: Int): String = clean(raw, sourceCount).take(12_000)

    private fun clean(raw: String, sourceCount: Int): String {
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
        return displayed
    }

    private val visualTags = listOf("DIAGRAM", "SKETCH", "WORKFLOW", "FLOW", "BOX", "BAR", "PIE", "FORMULA", "TREE", "STEPS", "MAP", "PLOT", "SCATTER", "SCIENCE", "SIM")
    private val openVisual = Regex("""^\[(DIAGRAM|SKETCH|WORKFLOW|FLOW|BOX|BAR|PIE|FORMULA|TREE|STEPS|MAP|PLOT|SCATTER)](?:\s.*)?$""")
    /** Models occasionally wrap their declarative output in a Markdown fence.
     * Unwrap only a recognized visual block in an untyped/visual fence; preserve actual code. */
    private fun normalizeVisualFences(text: String, final: Boolean): String {
        val rows = text.lines()
        val result = mutableListOf<String>()
        val fence = "\u0060\u0060\u0060"
        var i = 0
        while (i < rows.size) {
            val line = rows[i].trim()
            if (line in setOf(fence, fence + "diagram", fence + "visual")) {
                val first = (i + 1 until rows.size).firstOrNull { rows[it].isNotBlank() }
                val next = first?.let { rows[it].trim() }.orEmpty()
                val native = next.isNotEmpty() && visualTags.any { tag ->
                    val marker = "[" + tag + "]"
                    next.startsWith(marker) || marker.startsWith(next)
                }
                if (native && first != null) {
                    val close = (first + 1 until rows.size).firstOrNull { rows[it].trim() == fence }
                    if (close == null && !final) break
                    result += rows.subList(first, close ?: rows.size)
                    i = if (close == null) rows.size else close + 1
                    continue
                }
            }
            // A literal code fence owns its entire body, including any example markers.
            if (line.startsWith(fence)) {
                result += rows[i++]
                while (i < rows.size) {
                    val literal = rows[i++]
                    result += literal
                    if (literal.trim() == fence) break
                }
                continue
            }
            result += rows[i++]
        }
        return result.joinToString("\n")
    }

    private val partialCitation = Regex("""\[\d{0,3}$""")
    /** Hold incomplete native visual blocks and unfinished formatting markers.
     * Complete code fences are handled separately; never hide literal code. */
    fun streamingVisible(raw: String, sourceCount: Int, final: Boolean = false): String {
        val cleaned = normalizeVisualFences(clean(raw, sourceCount), final)
        check(cleaned.length <= 12_000) { "Response exceeds the saved-answer limit. Ask for a shorter response." }
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
            if (stack.isEmpty() && trimmed.startsWith("[SIM]")) {
                if (final || index < lines.lastIndex) {
                    val simulation = AuSimulationKind.fromKey(trimmed.removePrefix("[SIM]").trim())
                    output += if (simulation == null) "This simulation is unavailable." else "[SIM] " + simulation.key
                }
                continue
            }
            if (stack.isEmpty() && trimmed.startsWith("[SCIENCE]")) {
                if (final || index < lines.lastIndex) {
                    val template = AuScienceTemplate.fromKey(trimmed.removePrefix("[SCIENCE]").trim())
                    output += if (template == null) "This illustration is unavailable. Try another visual." else "[SCIENCE] " + template.key
                }
                continue
            }
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
            if (!final && trimmed.startsWith("|") && index == lines.lastIndex &&
                (index == 0 || !lines[index - 1].trim().startsWith("|"))) continue
            if (index == lines.lastIndex) {
                if (trimmed.isNotEmpty() && (visualTags.any { ("[" + it + "]").startsWith(trimmed) } ||
                    trimmed.matches(Regex("""#{1,6}\s*|[-*]\s*|\d+[.)]\s*""")))) continue
                output += line.replace(partialCitation, "").let { text ->
                    if (!final && text.endsWith("*") && !text.endsWith("**")) text.dropLast(1) else text
                }
            } else output += line
        }
        if (final && stack.isNotEmpty()) {
            if (stack.size == 1 && stack.first() == "BOX") {
                // Preserve readable callout prose, but not nested native commands.
                output += pending.takeWhile { line -> line == pending.first() ||
                    (!line.trim().startsWith("[") && '|' !in line && !line.trim().startsWith("\u0060\u0060\u0060")) }
            } else output += "An incomplete visual could not be rendered. Regenerate to try again."
        }
        return output.joinToString("\n")
    }

}
