package au.datacube.app.data.rag

/** Local character guard, not a tokenizer. Keep the actual question intact. */
internal object AuChatInputLimits {
    const val MAX_MESSAGE_CHARS = 2_000
    const val MAX_CONTEXTUAL_QUESTION_CHARS = 6_000
    fun allowed(message: String): Boolean = message.length <= MAX_MESSAGE_CHARS
    fun requireQuestion(message: String) {
        require(message.isNotBlank() && message.length <= MAX_CONTEXTUAL_QUESTION_CHARS) {
            "This question exceeds the local context limit. Split it into smaller questions."
        }
    }
    fun boundedExcerpt(text: String, limit: Int): String {
        val end = minOf(text.length, limit.coerceAtLeast(0))
        if (end == 0) return ""
        return text.substring(0, if (end < text.length && text[end - 1].isHighSurrogate()) end - 1 else end)
    }
}
