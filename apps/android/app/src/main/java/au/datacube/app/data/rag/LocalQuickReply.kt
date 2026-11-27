package au.datacube.app.data.rag

/** Only exact, context-independent social phrases bypass inference. All substantive questions use the model. */
internal object LocalQuickReply {
    fun forMessage(message: String): String? = when (
        message.trim().lowercase(java.util.Locale.ROOT).trimEnd('!', '.', '?').trim()
    ) {
        "hi", "hey", "hello", "hi au", "hey au", "hello au" -> "Hello! How can I help?"
        "thanks", "thank you", "thanks au", "thank you au" -> "You're welcome."
        else -> null
    }
}
