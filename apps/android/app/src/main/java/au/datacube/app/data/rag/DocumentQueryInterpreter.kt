package au.datacube.app.data.rag

import java.util.Locale
import kotlin.math.min

/** Fast source-aware routing; this does NOT pretend to be a generative LLM. */
data class DocumentQueryPlan(
    val retrievalQuery: String,
    val overview: Boolean,
    val correctedTerms: Map<String, String>,
    val clarification: String? = null,
    val contextualQuestion: String? = null
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

    /**
     * Corrects only when a matching term is supported by the document preview.
     * Real-word ambiguity is resolved using the source, never by guessing facts.
     * Short referential follow-ups may inherit the prior question in this thread.
     */
    fun understand(
        query: String,
        documentText: String,
        previousQuestion: String? = null
    ): DocumentQueryPlan {
        AuChatInputLimits.requireQuestion(query)
        val queryTokens = tokens(query)
        if (queryTokens.isEmpty()) {
            return DocumentQueryPlan(query.trim(), false, emptyMap(),
                clarification = "What would you like to know about this document?")
        }
        val referential = isReferentialFollowUp(query, queryTokens)
        val previous = previousQuestion?.takeIf { it.isNotBlank() && it != query }
        if (referential && previous == null) {
            return DocumentQueryPlan(query.trim(), false, emptyMap(),
                clarification = "Which topic or part of the document do you mean?")
        }
        val contextualQuestion = if (referential && previous != null)
            "Earlier question: ${previous.take(220)}. Follow-up: ${query.trim()}"
        else null
        val searchTerms = if (contextualQuestion != null) {
            queryTokens + tokens(previous.orEmpty())
        } else queryTokens

        // A targeted question ("explain ATP in this document") must retrieve
        // that topic, not replace it with an unrelated whole-document overview.
        val generic = overviewTerms + overviewActions + ignore + setOf(
            "is", "in", "of", "to", "the", "a", "an", "all", "key", "brief",
            "briefly", "whole", "entire", "give", "me", "can", "you", "does", "do",
            "it", "its", "are", "concepts", "points", "covered", "mainly"
        )
        val specificTerms = queryTokens.filterNot { it in generic || near(it, "document") }
        val asksOverview = queryTokens.any { it in overviewActions } &&
            (queryTokens.any { it in overviewTerms || near(it, "document") } ||
                queryTokens.any { it in setOf("summarize", "summary", "overview") })
        val sourceReference = Regex("""\b(?:this|the|my)\s+(?:[\p{L}\p{N}]+\s+){0,3}?(?:document|notes?|lecture notes?|pdf|file|material)\b""", RegexOption.IGNORE_CASE)
        val teacherWords = setOf("teach", "teaching", "students", "student", "class", "lesson", "plan", "prepare", "using", "use", "lecture", "want", "help", "make", "for", "based", "on", "to", "how", "can", "do", "would", "my", "our")
        val wholeDocumentTeaching = Regex("""\b(?:teach|teaching|lesson plan|prepare a lesson)\b""", RegexOption.IGNORE_CASE).containsMatchIn(query) &&
            sourceReference.containsMatchIn(query) &&
            tokens(sourceReference.replace(query, " ")).all { it in generic || it in teacherWords }
        val introductoryOverview = Regex("""^(?:please\s+)?(?:explain|teach|simplify|summari[sz]e)\s+(?:this|the|my)\s+(?:document|book|textbook|pdf|file|notes|material)(?:\s+to me)?\s+(?:like|as if|for|in|that)\b.*$""", RegexOption.IGNORE_CASE).matches(query.trim()) &&
            Regex("""\b(?:beginner|newbie|child|three|five|simple|plain|easy|years? old|nerd)\b""",RegexOption.IGNORE_CASE).containsMatchIn(query)
        val overview = ((asksOverview && specificTerms.isEmpty()) || wholeDocumentTeaching || introductoryOverview) && contextualQuestion == null
        if (overview) return DocumentQueryPlan(query.trim(), true, emptyMap(),
            contextualQuestion = contextualQuestion)

        // The preview is intentionally bounded; never imply that these
        // corrections cover all the vocabulary of a larger extracted document.
        val frequency = tokens(documentText.take(64_000))
            .filter { it.length >= 4 && it !in ignore }
            .groupingBy { it }.eachCount()
        val vocabulary = frequency.keys.take(2_400)
        val corrected = mutableMapOf<String, String>()
        val suggestions = mutableListOf<String>()
        searchTerms.filter { it.length in 4..48 && it !in ignore && it !in frequency }
            .distinct().take(12).forEach { term ->
                val maxDistance = if (term.length >= 5) 2 else 1
                val nearMatches = vocabulary.asSequence()
                    .filter { kotlin.math.abs(it.length - term.length) <= maxDistance }
                    .mapNotNull { word ->
                        val edit = distance(term, word, maxDistance)
                        if (edit in 1..maxDistance) word to edit else null
                    }.toList()
                val bestDistance = nearMatches.minOfOrNull { it.second } ?: return@forEach
                val best = nearMatches.filter { it.second == bestDistance }
                if (best.size == 1) {
                    val candidate = best.single().first
                    if (bestDistance == 1) {
                        corrected[term] = candidate
                    } else if (suggestions.isEmpty()) {
                        suggestions += "Did you mean '$candidate' instead of '$term'?"
                    }
                } else if (bestDistance == 1 && best.size in 2..3 && suggestions.isEmpty()) {
                    suggestions += "Did you mean " +
                        best.joinToString(" or ") { "'${it.first}'" } + "?"
                }
            }
        val retrievalQuery = searchTerms.flatMap { term -> listOfNotNull(term, corrected[term]) }.distinct().joinToString(" ")
        val clarifiedQuestion = if (contextualQuestion == null && corrected.isEmpty()) null
            else buildString {
                if (contextualQuestion != null) appendLine(contextualQuestion)
                else appendLine("Original question: ${query.trim().take(350)}")
                if (corrected.isNotEmpty()) {
                    appendLine("Possible source-supported spelling (original question still applies): " +
                        corrected.entries.joinToString("; ") { (original, correctedTerm) -> "$original → $correctedTerm" })
                }
                append("Use source evidence; prefer the original meaning where supported. Ask only if a different interpretation materially changes the answer.")
            }
        return DocumentQueryPlan(
            retrievalQuery = retrievalQuery,
            overview = false,
            correctedTerms = corrected,
            clarification = suggestions.firstOrNull()?.takeIf {
                // Ask only on very short prompts where guessing would mislead.
                queryTokens.size <= 4
            },
            contextualQuestion = clarifiedQuestion
        )
    }

    fun isReferentialFollowUp(query: String): Boolean = isReferentialFollowUp(query, tokens(query))

    private fun isReferentialFollowUp(query: String, terms: List<String>): Boolean {
        if (terms.size > 6) return false
        val text = query.lowercase(Locale.ROOT).trim()
        if (text.startsWith("what about ") || text.startsWith("and what about ") ||
            text.startsWith("tell me more") || text.startsWith("explain that") ||
            text.startsWith("and why") || text.startsWith("and how")) return true
        val vague = setOf(
            "why", "how", "it", "that", "this", "these", "those", "more",
            "and", "what", "about", "then", "again", "please", "explain",
            "elaborate", "details", "detail", "can", "you", "does", "do", "so"
        )
        return terms.size <= 4 && terms.all { it in vague }
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
