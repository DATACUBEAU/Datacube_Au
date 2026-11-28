package au.datacube.app.data.rag

import java.util.Locale

/** Never infer an answer from keyword presence. This only chooses retrieval effort. */
internal object AuInteractiveLatency {
    private val definition = Regex("""^(?:what (?:is|are)|define|meaning of)\s+([\p{L}\p{N}-]+(?:\s+[\p{L}\p{N}-]+){0,2})[?.! ]*$""", RegexOption.IGNORE_CASE)
    private val complex = Regex("""\b(?:and|or|versus|vs|difference|compare|relationship|cause|effects?|this|that|these|those|it|they|them|my|your|our|above|previous|current|latest|today|now|why|how)\b""", RegexOption.IGNORE_CASE)
    private val word = Regex("""[\p{L}\p{N}]+""")
    private fun topic(question: String): String? =
        definition.matchEntire(question.trim())?.groupValues?.get(1)
            ?.takeUnless { complex.containsMatchIn(it) || it.length < 3 }

    fun generalEffort(question: String, selected: AuEffort): AuEffort =
        if (selected == AuEffort.BALANCED && topic(question) != null &&
            AuTeachingPolicy.plan(question).visual != AuTeachingPolicy.Visual.REQUESTED) AuEffort.FAST
        else selected

    fun canUseLexicalOnly(question: String, effort: AuEffort, topPassage: String?): Boolean {
        if (effort != AuEffort.FAST || topPassage.isNullOrBlank()) return false
        val terms = topic(question)?.let { word.findAll(it.lowercase(Locale.ROOT)).map { m -> m.value }.toSet() }
            ?: return false
        val passage = word.findAll(topPassage.lowercase(Locale.ROOT)).map { it.value }.toSet()
        return terms.isNotEmpty() && terms.all { it in passage }
    }
}
