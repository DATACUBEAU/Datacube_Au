package au.datacube.app.data.rag

/** Plan on the actual user question, never the concatenated evidence prompt.
 * This is a generation budget, not a guarantee of correctness or latency. */
internal data class AuAnswerPlan(
    val outputTokens: Int,
    val thinkingTokens: Int?,
    val instruction: String
) {
    companion object {
        private val longRequest = Regex("""\b(?:detailed|in detail|comprehensive|essay|report|derive|prove|step by step|step-by-step|compare|contrast|all|every|exhaustive)\b""", RegexOption.IGNORE_CASE)
        private val shortRequest = Regex("""\b(?:briefly|quick answer|one sentence|short answer|keep it short)\b""", RegexOption.IGNORE_CASE)
        private val definition = Regex("""^(?:what (?:is|are)|define|meaning of)\s+[\p{L}\p{N}-]+(?:\s+[\p{L}\p{N}-]+){0,2}[?.! ]*$""", RegexOption.IGNORE_CASE)
        private val dependent = Regex("""\b(?:it|this|that|these|those|they|them|my|our|your|and|or|today|latest|current|why|how)\b""", RegexOption.IGNORE_CASE)

        fun build(question: String?, effort: AuEffort, modelId: String,
            lowRam: Boolean, visual: Boolean, multimodal: Boolean): AuAnswerPlan {
            val q = question.orEmpty().trim()
            val detailed = longRequest.containsMatchIn(q)
            val brief = q.isNotEmpty() && shortRequest.containsMatchIn(q) && !detailed && !visual
            val simple = q.isNotEmpty() && !detailed && !visual && !multimodal &&
                definition.matches(q) && !dependent.containsMatchIn(q) && effort.ordinal <= AuEffort.BALANCED.ordinal
            val budget = when {
                brief -> minOf(effort.outputTokens, 384)
                simple -> minOf(effort.outputTokens, 512)
                else -> effort.outputTokens
            }
            val baseThinking = effort.thinkingBudget(modelId, lowRam)
            val thinking = if ((brief || simple) && effort.ordinal <= AuEffort.BALANCED.ordinal)
                baseThinking?.let { 0 } else baseThinking
            val shape = when {
                brief -> "Give the direct answer in a short paragraph. Follow explicit length instructions."
                simple -> "Start with the definition. Add only the essential explanation or example; no forced headings."
                visual -> "Give the key explanation first, then the requested complete visual block and its interpretation."
                detailed -> "Start with the answer or conclusion. Develop the explanation in ordered sections or numbered steps; include relevant evidence and examples."
                else -> "Start with the direct answer. Add supporting explanation in logical order. Use headings or numbered steps only when they improve readability."
            }
            return AuAnswerPlan(budget, thinking, "$shape Do not announce a plan, repeat the question, or expose private reasoning. Complete the answer before ending.")
        }
    }
}
