package au.datacube.app.data.rag

import java.util.Locale

/** Small talk is conversational, not a claim about a source PDF. */
object DocumentChatIntent {
    private val greetings = Regex(
        """^(?:(?:hi|hello|hey|yo|good morning|good afternoon|good evening|what'?s up|how are you|how'?s it going|thanks|thank you|hello au|hi au|hey au)[!.?\s]*)$"""
    )
    fun isGreeting(question: String): Boolean =
        question.trim().lowercase(Locale.ROOT).let {
            it.length <= 48 && greetings.matches(it)
        }
}
