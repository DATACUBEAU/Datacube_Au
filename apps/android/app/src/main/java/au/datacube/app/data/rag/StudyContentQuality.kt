package au.datacube.app.data.rag

import java.util.Locale

/**
 * Removes common PDF front-matter noise from extractive study aids.
 * Never adds facts: every phrase returned originates from the document.
 */
object StudyContentQuality {
    private val boilerplateMarkers = Regex(
        """(?i)(?:copyright\s*(?:©|\(c\)|\d{4})|©\s*\d{4}|all rights reserved|no part of this (?:book|publication|work)|isbn[ -]?(?:10|13)?|trademark|published by|first published|printed in (?:the|usa|uk)|cataloguing in publication)"""
    )
    private val filler = Regex(
        """(?i)^(?:page\s+\d+|contents|table of contents|about the author|acknowledgments?|index|preface|dedication|language|chapter|chapter\s+\d+)$"""
    )
    private val meaningful = Regex(
        """(?i)\b(?:how|why|learn|build|create|design|implement|explain|understand|introduc\w*|develop\w*|guide|cover\w*|teach\w*|use\w*|work\w*|concepts?|applications?|examples?|features?|methods?|architecture|techniques?)\b"""
    )

    fun cleanExcerpt(raw: String): String {
        val normal = raw.replace(Regex("""\s+"""), " ").trim()
        val boundary = boilerplateMarkers.find(normal)?.range?.first ?: normal.length
        return normal.take(boundary).trim().trimEnd('.', ',', ';', ':', '-').let {
            if (it.isNotEmpty() && it.last() !in ".!?") "$it." else it
        }
    }

    fun score(raw: String): Int {
        val text = cleanExcerpt(raw)
        if (text.isBlank() || filler.matches(text.trimEnd('.')) || text.length < 45) return -1
        val words = text.split(Regex("""\s+""")).size
        if (words < 8) return -1
        var value = minOf(text.length, 250) / 15
        if (words in 9..45) value += 9
        if (meaningful.containsMatchIn(text)) value += 12
        if (text.endsWith(".")) value += 2
        if (raw.length > text.length + 30) value -= 3
        return value
    }

    fun chooseOverview(passages: List<RagEvidence>, limit: Int = 4): List<RagEvidence> {
        require(limit in 1..8)
        // Choose informative passages from different pages, not consecutive
        // copyright/title fragments from the beginning of a textbook.
        val ranked = passages.mapIndexed { index, passage ->
            Triple(index, passage, score(passage.text))
        }.filter { it.third > 0 }
            .sortedWith(compareByDescending<Triple<Int, RagEvidence, Int>> { it.third }.thenBy { it.first })
        if (ranked.isEmpty()) return passages.take(limit)
        val selected = mutableListOf<Triple<Int, RagEvidence, Int>>()
        val pages = mutableSetOf<Int>()
        for (item in ranked) {
            if (item.second.page != null && item.second.page in pages) continue
            selected += item
            item.second.page?.let(pages::add)
            if (selected.size >= limit) break
        }
        if (selected.size < limit) {
            for (item in ranked) {
                if (item.first !in selected.map { it.first }) selected += item
                if (selected.size >= limit) break
            }
        }
        return selected.sortedBy { it.first }.map { item ->
            item.second.copy(text = cleanExcerpt(item.second.text))
        }
    }

    fun extractiveSummary(passages: List<RagEvidence>, count: Int = 3): String {
        val chosen = chooseOverview(passages, count.coerceIn(1, 6))
        return chosen.map { cleanExcerpt(it.text) }.filter { score(it) > 0 }
            .distinctBy { it.lowercase(Locale.ROOT) }
            .take(count)
            .joinToString(" ")
            .take(950)
            .ifBlank { "The extracted preview contains no clear study passage yet. Try opening a content chapter or importing a text-searchable document." }
    }

    fun usefulHeading(candidate: String): Boolean {
        val line = candidate.trim()
        if (line.isBlank() || line.length !in 6..75 || boilerplateMarkers.containsMatchIn(line)) return false
        if (filler.matches(line)) return false
        val words = line.split(Regex("""\s+"""))
        if (words.size !in 2..10) return false
        if (line.any(Char::isDigit) && line.length < 12) return false
        return true
    }
}
