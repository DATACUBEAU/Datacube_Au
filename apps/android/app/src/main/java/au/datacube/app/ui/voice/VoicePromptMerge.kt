package au.datacube.app.ui.voice

/** Keep recognized speech as editable text. Sending always requires a separate tap. */
fun mergeVoicePrompt(existing: String, transcript: String): String {
    val spoken = transcript.trim().replace(Regex("\\s+"), " ")
    if (spoken.isBlank()) return existing.take(500)
    return listOf(existing.trim(), spoken)
        .filter(String::isNotBlank)
        .joinToString(" ")
        .take(500)
}
