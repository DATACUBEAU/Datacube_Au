package au.datacube.app.data.rag

import java.util.Locale

/** Conversation supplies context, never independent evidence. */
object AuFollowUp {
    data class Resolution(val query: String, val contextual: Boolean = false, val reply: String? = null)
    private val continuation = setOf("go on","continue","carry on","okay go on","ok go on","yes go on","proceed","yes","okay","ok","sure","tell me more","more","explain more","and then","what next")
    private val completeness = setOf("is that it","is that all","anything else","is there more")
    private val choiceLine = Regex("""^\s*(?:#{1,6}\s+)?(?:[-*]\s+)?(?:\*\*)?(?:(?:section|option|part)\s+)?([A-Da-d]|[1-4])[.)\s:–-]+(.{3,100})$""")
    private val selection = Regex("""^(?:(?:okay|ok|yes)\s+)?(?:(?:go on with|continue with|explain|choose)\s+)?(?:section|option|part)\s+([a-d1-4])$""")
    private fun normalized(text: String) = text.trim().lowercase(Locale.ROOT).replace(Regex("""[?!.,]+""")," ").replace(Regex("""\s+""")," ").trim()

    internal fun choices(answer: String): List<Pair<String,String>> =
        answer.takeLast(4000).lineSequence().mapNotNull { line ->
            val m = choiceLine.matchEntire(line) ?: return@mapNotNull null
            m.groupValues[1].uppercase(Locale.ROOT) to m.groupValues[2].replace("**","").trim().take(100)
        }.distinctBy { it.first }.take(4).toList()

    fun resolve(question: String, previous: List<RagTurn>, documentScope: Boolean): Resolution {
        val q = normalized(question)
        val last = previous.lastOrNull { it.answer.isNotBlank() && it.question.isNotBlank() }
        val options = choices(last?.answer.orEmpty())
        val requested = selection.matchEntire(q)?.groupValues?.get(1)?.uppercase(Locale.ROOT)
        val chosen = options.firstOrNull { it.first == requested }
        if (chosen != null) {
            val task = if (documentScope) when (chosen.second) {
                "Key concepts" -> "Summarize the key concepts in this document"
                "Section-by-section explanation" -> "Outline the sections of this document"
                "Practice questions" -> "Create practice questions from this document"
                else -> "Explain " + chosen.second
            } else "Explain " + chosen.second + " for " + previous.asReversed().firstOrNull {
                normalized(it.question) !in continuation && normalized(it.question) !in completeness
            }?.question.orEmpty().take(240)
            return Resolution(task,true)
        }
        if (requested != null) return Resolution(question)
        if (q in completeness && last != null) return Resolution(question,true,reply=if (documentScope)
            "There may be more to explore. What would help you most?\nA. Key concepts\nB. Section-by-section explanation\nC. Practice questions"
            else "We can explore this further. What would help you most?\nA. Examples\nB. A deeper explanation\nC. Practical applications")
        if (q !in continuation) return Resolution(question)
        if (last == null) return Resolution(question,reply="What would you like me to continue with?")
        if (options.size > 1 && (last.answer.contains('?') || last.answer.contains("choose",true) || last.answer.contains("would you like",true))) {
            return Resolution(question,true,reply="Which would you like me to continue with?\n"+
                options.joinToString("\n") { (key,label) -> "$key. $label" })
        }
        if (last.answer.takeLast(600).contains('?') && Regex("""\b(?:or|which)\b""", RegexOption.IGNORE_CASE).containsMatchIn(last.answer.takeLast(600)) && q in setOf("yes","okay","ok","sure","go on","continue","okay go on","ok go on","yes go on","proceed")) {
            return Resolution(question,true,reply="Which part would you like me to continue with?")
        }
        val anchor = previous.asReversed().firstOrNull { normalized(it.question) !in continuation && normalized(it.question) !in completeness } ?: last
        return Resolution("Continue explaining: "+anchor.question.take(350),true)
    }
}
