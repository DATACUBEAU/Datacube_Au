package au.datacube.app.data.rag

import java.util.Locale

/** Conversation supplies context, never independent evidence. */
object AuFollowUp {
    data class Resolution(val query: String, val contextual: Boolean = false, val reply: String? = null)
    private val continuation = setOf("go on","continue","carry on","okay go on","ok go on","yes go on","proceed","yes","okay","ok","sure","tell me more","more","explain more","and then","what next","guide me","guide me through","guide me through it","show me how","help me understand")
    private val delegated = Regex("""^(?:(?:okay|ok|yes)\s+)?(?:you (?:choose|decide|pick)|(?:just )?(?:go with|choose|pick|select|do) (?:any(?:one|thing)?|whichever|whatever|what) (?:you think (?:is )?(?:best|better)|you (?:prefer|recommend)|is best)|(?:whatever|whichever) (?:you think is best|you recommend)|(?:just )?(?:choose|pick) (?:the best|for me))$""")
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
        val delegate = delegated.matches(q) || q in setOf("anyone you think is best","anything you think is best","whatever is best","you know best","recommend one","go with anyone i think that is best","just go with anyone i think that is best")
        val chosen = if (delegate) options.firstOrNull() else options.firstOrNull { it.first == requested }
        if (chosen != null) {
            val task = if (documentScope) when (chosen.second) {
                "Key concepts" -> "Summarize the key concepts in this document"
                "Section-by-section explanation" -> "Outline the sections of this document"
                "Practice questions" -> "Create practice questions from this document"
                else -> "Explain " + chosen.second
            } else "Explain " + chosen.second + " for " + previous.asReversed().firstOrNull {
                normalized(it.question) !in continuation && normalized(it.question) !in completeness && !delegated.matches(normalized(it.question))
            }?.question.orEmpty().take(240)
            return Resolution(if (delegate) task + ". Choose this as the next step and briefly explain why." else task,true)
        }
        if (requested != null) return Resolution(question)
        if (delegate) {
            if (last == null) return Resolution(question,reply="What topic would you like help with?")
            return Resolution("Recommend and explain one useful next step for: " + last.question.take(300) + ". Use the previous answer to avoid repeating completed material.",true)
        }
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
        return Resolution("Continue from the previous reply about: "+anchor.question.take(350)+". Do not repeat completed material; give the next useful explanation or guided step.",true)
    }
}
