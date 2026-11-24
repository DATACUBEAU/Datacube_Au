package au.datacube.app.data.rag

import java.time.Instant
import java.time.ZoneId
import java.util.Locale

/** Prior conversation is useful context, never independent factual evidence. */
data class ConversationEntry(val question: String, val at: Long?, val isUser: Boolean)

object AuConversationContext {
    private val words = Regex("""[\p{L}\p{N}]{2,}""")
    private val stop = setOf("the", "and", "what", "why", "how", "was", "is", "are", "it", "that", "this", "in", "to", "of", "for", "on", "me", "my", "we", "you", "our", "can", "could", "please", "explain", "about", "with", "from", "more", "again")
    private val recall = Regex("""^(?:au[, ]+)?(?:please\s+)?(?:what (?:did we|were we|have we)\s+(?:talk(?:ing|ed)?(?: about)?|discuss(?:ing|ed)?|study(?:ing|ied)?|learn(?:ing|ed)?|cover(?:ing|ed)?)(?:\s+about)?|(?:recap|summari[sz]e|remind me (?:of|what))\s+(?:our|what we|the previous|the last)\b).*?\byesterday\b[?.! ]*$""", RegexOption.IGNORE_CASE)

    fun asksYesterdayRecap(question: String): Boolean = recall.matches(question.trim())

    fun yesterdayReply(entries: List<ConversationEntry>, now: Long = System.currentTimeMillis(),
        zone: ZoneId = ZoneId.systemDefault()): String {
        val yesterday = Instant.ofEpochMilli(now).atZone(zone).toLocalDate().minusDays(1)
        val known = entries.filter { entry ->
            entry.isUser && entry.at?.let {
                Instant.ofEpochMilli(it).atZone(zone).toLocalDate() == yesterday
            } == true && entry.question.isNotBlank() && !asksYesterdayRecap(entry.question) && AuMemoryCommand.parse(entry.question) == null
        }.sortedBy { it.at }
        val distinct = known.distinctBy { it.question.trim().lowercase(Locale.ROOT) }.takeLast(6)
        if (distinct.isEmpty()) {
            return if (entries.any { it.isUser && it.at == null })
                "Some older chats don't have saved dates, so I can't reliably tell which topics we discussed yesterday. Tell me the topic or open the earlier chat, and we can continue."
            else "I couldn't find saved questions from yesterday in this workspace. Tell me where we left off and we can continue."
        }
        return buildString {
            appendLine("Yesterday, you asked about these topics in this workspace:")
            distinct.forEach { appendLine("- " + it.question.replace(Regex("""\s+"""), " ").trim().take(180)) }
            append("Would you like to review one of these topics or try a few practice questions?")
        }.trim()
    }

    private fun terms(text: String): Set<String> = words.findAll(text.lowercase(Locale.ROOT))
        .map { it.value }.filterNot { it in stop }.toSet()

    /** Retain two most recent turns and add the best older matching turn(s).
     * Context size is deliberately bounded for every model. No cross-thread injection.
     */
    fun select(question: String, history: List<RagTurn>, maxTurns: Int = 3): List<RagTurn> {
        val usable = history.takeLast(20).filter { it.question.isNotBlank() && it.answer.isNotBlank() }
        val count = maxTurns.coerceIn(1, 5)
        val recent = usable.indices.toList().takeLast(minOf(2, count, usable.size))
        val query = terms(question)
        val relevant = usable.indices.filterNot { it in recent }.map { index ->
            index to (terms(usable[index].question).intersect(query).size * 3 +
                terms(usable[index].answer.take(900)).intersect(query).size)
        }.filter { it.second > 0 }.sortedWith(compareByDescending<Pair<Int, Int>> { it.second }.thenByDescending { it.first })
            .take(count - recent.size).map { it.first }
        val remaining = usable.indices.reversed().filterNot { it in recent || it in relevant }.take(count - recent.size - relevant.size)
        return (recent + relevant + remaining).distinct().sorted().map { usable[it] }
    }

    fun compactModel(modelId: String?): Boolean = modelId == "qwen3-0.6b-litert"
}
