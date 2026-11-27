package au.datacube.app.audio

/**
 * Transcript prepared from source-grounded excerpts. "Host" and "Guide" are
 * roles in a single AI-generated dialogue, not two independent reasoning models.
 */
enum class PodcastSpeaker { HOST, GUIDE }

data class PodcastTurn(val speaker: PodcastSpeaker, val text: String)

object PodcastDialogue {
    const val MAX_TURNS = 14
    private val linePattern = Regex(
        """^\s*(?:[*_-]+\s*)?(HOST|GUIDE|EXPERT|GUEST|SPEAKER\s*[12])\s*:\s*(.+)$""",
        RegexOption.IGNORE_CASE
    )

    fun parse(raw: String): List<PodcastTurn> {
        val result = mutableListOf<PodcastTurn>()
        for (line in raw.lineSequence()) {
            val clean = line.trim().trimStart('-', '*', ' ')
            val match = linePattern.find(clean)
            if (match != null) {
                val role = match.groupValues[1].uppercase().replace(Regex("""\s+"""), "")
                val speaker = if (role == "HOST" || role == "SPEAKER1") {
                    PodcastSpeaker.HOST
                } else PodcastSpeaker.GUIDE
                val text = sanitize(match.groupValues[2])
                if (text.isNotBlank()) {
                    if (result.lastOrNull()?.speaker == speaker) {
                        result[result.lastIndex] = PodcastTurn(speaker, sanitize(result.last().text + " " + text))
                    } else result += PodcastTurn(speaker, text)
                }
            } else if (result.isNotEmpty() && !clean.startsWith("#")) {
                // Some small local models wrap a long line. Preserve it as part
                // of the preceding speaker, never as an unattributed third voice.
                val continued = sanitize(result.last().text + " " + clean)
                result[result.lastIndex] = result.last().copy(text = continued)
            }
            require(result.size <= MAX_TURNS) { "Podcast has too many speaker turns. Regenerate a shorter dialogue." }
        }
        val useful = result.dropWhile { it.speaker != PodcastSpeaker.HOST }
            .dropLastWhile { it.speaker != PodcastSpeaker.GUIDE }
        require(useful.size >= 4 && useful.size % 2 == 0 &&
            useful.all { it.text.length in 8..2_000 } &&
            useful.zipWithNext().all { (a, b) -> a.speaker != b.speaker } &&
            useful.any { it.speaker == PodcastSpeaker.HOST && '?' in it.text }) {
            "The AI did not produce a clear two-speaker discussion. Try generating again."
        }
        return useful
    }

    fun sanitize(text: String): String =
        text.replace(Regex("""(?s)<think>.*?</think>"""), "")
            .replace(Regex("""\[(?:\d{1,2})\]"""), "")
            .replace(Regex("""(?i)(?:https?://|www\.)[^\s<>]+"""), "link in the document")
            .replace(Regex("""\s+"""), " ")
            .replace(Regex("""^[\"'*\s]+|[\"'*\s]+$"""), "")
            .trim()

    fun voiceFor(speaker: PodcastSpeaker): String =
        if (speaker == PodcastSpeaker.HOST) "af_heart" else "am_adam"

    fun spokenPairs(turns: List<PodcastTurn>): List<Pair<String, String>> =
        turns.take(MAX_TURNS).map { voiceFor(it.speaker) to it.text }
}
