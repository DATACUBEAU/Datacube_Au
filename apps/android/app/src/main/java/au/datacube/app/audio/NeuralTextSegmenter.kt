package au.datacube.app.audio

/** Small punctuation-aware chunks reduce CPU speech startup and keep playback responsive. */
object NeuralTextSegmenter {
    fun split(input: String, maxChunk: Int = 260, maxText: Int = 2200): List<String> {
        require(maxChunk in 100..1000)
        require(maxText in maxChunk..12000)
        val normalized = input.replace(Regex("""\s+"""), " ").trim().take(maxText)
        if (normalized.isBlank()) return emptyList()
        val result = mutableListOf<String>()
        var offset = 0
        while (offset < normalized.length) {
            val remaining = normalized.length - offset
            if (remaining <= maxChunk) {
                normalized.substring(offset).trim().takeIf { it.isNotBlank() }?.let(result::add)
                break
            }
            val maxEnd = offset + maxChunk
            val minimumEnd = offset + (maxChunk / 2)
            val preferred = (minimumEnd until maxEnd).lastOrNull { index ->
                normalized[index] in ".!?" && normalized.getOrNull(index + 1) == ' '
            }?.plus(1)
            val wordEnd = (minimumEnd until maxEnd).lastOrNull { normalized[it] == ' ' }
            val cut = preferred ?: wordEnd ?: maxEnd
            normalized.substring(offset, cut).trim().takeIf { it.isNotBlank() }?.let(result::add)
            offset = cut
            while (offset < normalized.length && normalized[offset] == ' ') offset++
        }
        return result
    }
}
