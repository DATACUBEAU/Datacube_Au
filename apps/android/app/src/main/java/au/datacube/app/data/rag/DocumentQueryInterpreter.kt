package au.datacube.app.data.rag

import java.util.Locale
import kotlin.math.min

/** Fast source-aware routing; this does NOT pretend to be a generative LLM. */
data class DocumentQueryPlan(
    val retrievalQuery: String,
    val overview: Boolean,
    val correctedTerms: Map<String, String>
)

object DocumentQueryInterpreter {
    private val words = Regex("""[\p{L}\p{N}]{2,}""")
    private val overviewTerms = setOf(
        "document", "doc", "file", "pdf", "book", "chapter", "content", "notes", "text"
    )
    private val overviewActions = setOf(
        "what", "about", "summary", "summarize", "overview", "describe", "inside",
        "contained", "contents", "topics", "main", "ideas", "tell", "explain", "outline"
    )
    private val ignore = setOf(
        "what", "which", "where", "when", "with", "your", "about", "have", "this",
        "that", "them", "there", "their", "does", "from", "some", "just", "tell",
        "please", "give", "will", "would", "could", "should", "explain", "and",
        "then", "than", "into", "also", "very", "more", "here", "show", "me"
    )

    fun understand(query: String, documentText: String): DocumentQueryPlan {
        val tokens = tokens(query)
        if (tokens.isEmpty()) return DocumentQueryPlan("", false, emptyMap())
        val overview = (tokens.any { it in overviewTerms || near(it, "document") } &&
            tokens.any { it in overviewActions }) ||
            (tokens.contains("summarize") && tokens.size <= 8) ||
            (tokens.contains("overview") && tokens.size <= 8) ||
            (tokens.contains("summary") && tokens.size <= 8)
        if (overview) return DocumentQueryPlan(query.trim(), true, emptyMap())
        val frequency = tokens(documentText.take(64_000))
            .filter { it.length >= 4 && it !in ignore }
            .groupingBy { it }.eachCount()
        val vocabulary = frequency.keys.take(2400)
        val corrected = mutableMapOf<String, String>()
        tokens.filter { it.length >= 4 && it !in ignore && it !in frequency }
            .distinct().forEach { term ->
                val limit = if (term.length >= 8) 2 else 1
                val nearMatches = vocabulary
                    .filter { kotlin.math.abs(it.length - term.length) <= limit }
                    .mapNotNull { word ->
                        val distance = distance(term, word, limit)
                        if (distance in 1..limit) word to distance else null
                    }
                val closestDistance = nearMatches.minOfOrNull { it.second } ?: return@forEach
                val best = nearMatches.filter { it.second == closestDistance }
                if (best.size == 1) corrected[term] = best.single().first
            }
        val resolved = tokens.joinToString(" ") { corrected[it] ?: it }
        return DocumentQueryPlan(resolved, false, corrected)
    }

    private fun tokens(input: String): List<String> =
        words.findAll(input.lowercase(Locale.ROOT)).map { it.value }.toList()

    private fun near(first: String, second: String): Boolean =
        first.length >= 5 && distance(first, second, 2) <= 2

    /** Bounded edit distance, including transposition to handle common keyboard mistakes. */
    internal fun distance(left: String, right: String, maximum: Int): Int {
        if (left == right) return 0
        if (kotlin.math.abs(left.length - right.length) > maximum) return maximum + 1
        val previous = IntArray(right.length + 1) { it }
        val current = IntArray(right.length + 1)
        val beforePrevious = IntArray(right.length + 1)
        for (i in 1..left.length) {
            current[0] = i
            for (j in 1..right.length) {
                val sub = if (left[i - 1] == right[j - 1]) 0 else 1
                current[j] = min(min(previous[j] + 1, current[j - 1] + 1), previous[j - 1] + sub)
                if (i > 1 && j > 1 &&
                    left[i - 1] == right[j - 2] && left[i - 2] == right[j - 1]) {
                    current[j] = min(current[j], beforePrevious[j - 2] + 1)
                }
            }
            if (current.minOrNull()!! > maximum) return maximum + 1
            previous.copyInto(beforePrevious)
            current.copyInto(previous)
        }
        return previous[right.length]
    }
}
