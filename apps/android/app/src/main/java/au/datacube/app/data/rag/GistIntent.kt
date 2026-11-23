package au.datacube.app.data.rag

import java.util.Locale

/** Gist normally chats from the installed AU model's own general knowledge.
 * Only explicit local-library requests can access document metadata/retrieval.
 */
enum class GistIntent { GENERAL, LIBRARY_COUNT, LIBRARY_LIST, DOCUMENT_SEARCH }

object GistRequestRouter {
    private val documentWords = Regex(
        """\b(?:documents?|docs?|pdfs?|files?|uploads?|notes|resumes?|cvs?|reports?)\b"""
    )
    private val personalLibrary = Regex(
        """\b(?:my|mine|i\s+(?:have|uploaded|saved|imported)|do\s+i\s+have|i've|uploaded|imported|saved|on\s+my\s+phone|in\s+(?:the|my)\s+app|my\s+library)\b"""
    )
    private val countWords = Regex(
        """\b(?:how\s+many|number\s+of|count|total|quantity)\b"""
    )
    private val listWords = Regex(
        """\b(?:list|show|name|which|what|display)\b"""
    )
    private val explicitDocumentSearch = Regex(
        """\b(?:search|find|compare|summarize|quote|check|contain|contains|mention|mentions|say|says|about|read|explain|look\s+up|according\s+to|based\s+on|inside|from|in)\b"""
    )

    fun classify(input: String): GistIntent {
        val query = input.lowercase(Locale.ROOT).replace(Regex("""\s+"""), " ").trim()
        if (!documentWords.containsMatchIn(query)) return GistIntent.GENERAL
        val personal = personalLibrary.containsMatchIn(query)
        if (!personal) return GistIntent.GENERAL
        if (countWords.containsMatchIn(query)) return GistIntent.LIBRARY_COUNT
        if (listWords.containsMatchIn(query) &&
            !explicitDocumentSearch.containsMatchIn(query)) return GistIntent.LIBRARY_LIST
        // A personal-document question is never silently treated as general knowledge.
        return GistIntent.DOCUMENT_SEARCH
    }

    fun libraryReply(intent: GistIntent, titles: List<String>): String {
        require(intent == GistIntent.LIBRARY_COUNT || intent == GistIntent.LIBRARY_LIST)
        val count = titles.size
        if (intent == GistIntent.LIBRARY_COUNT) {
            return "You have $count imported document(s) on this device."
        }
        if (count == 0) return "You have no imported documents on this device yet."
        val lines = titles.take(30).mapIndexed { index, title ->
            "${index + 1}. " + title.take(120).replace(Regex("""\s+"""), " ")
        }
        return buildString {
            appendLine("You have $count imported document(s) on this device.")
            append(lines.joinToString("\n"))
            if (count > lines.size) append("\nAnd ${count - lines.size} more in your document library.")
        }
    }
}

object GistPrompt {
    /** Recent pairs supply context to follow-ups; they are not evidence of facts. */
    fun build(question: String, previous: List<Pair<String, String>>): String {
        require(question.isNotBlank())
        val history = previous.takeLast(3).filter { it.first.isNotBlank() && it.second.isNotBlank() }
        return buildString {
            appendLine("GIST — NORMAL OFFLINE AU CONVERSATION")
            appendLine("You are chatting without searching imported documents.")
            appendLine("Answer from your general trained knowledge, not from imagined files.")
            appendLine("Minor spelling errors should be interpreted using conversational context.")
            appendLine("If the question is too incomplete or has two plausible meanings, ask one short clarification.")
            appendLine("Do not assume access to live news, current facts, the internet or the user's private files.")
            appendLine("Do not invent citations or pretend to have searched a document.")
            if (history.isNotEmpty()) {
                appendLine("RECENT CHAT (context, not external evidence):")
                history.forEach { (user, answer) ->
                    appendLine("User: " + user.take(220))
                    appendLine("AU: " + answer.take(380))
                }
            }
            appendLine("CURRENT USER MESSAGE:")
            appendLine(question.trim().take(900))
        }.take(7_500)
    }
}
