package au.datacube.app.data.rag

/** Response policy, not a promise of a native reasoning-token budget or faster hardware. */
enum class AuEffort(val label: String, val description: String, val sourceLimit: Int, val instruction: String) {
    FAST("Fast", "Short direct answers", 3, "Give a concise direct answer with essential explanation."),
    BALANCED("Balanced", "Adaptive depth", 5, "Match the explanation depth to the actual question."),
    DEEP("Deep", "More evidence and explanation", 8, "Explain difficult concepts carefully with relevant examples, explicit assumptions and a short verification of the conclusion. State uncertainty. Never reveal private reasoning.")
}
