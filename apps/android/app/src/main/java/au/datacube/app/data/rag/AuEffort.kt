package au.datacube.app.data.rag

import android.app.ActivityManager
import android.content.Context

/** Bounded native thinking budgets for Gemma 4; other models use context and output policy. */
enum class AuEffort(
    val label: String, val description: String, val sourceLimit: Int,
    val historyLimit: Int, val thinkingTokens: Int, val outputTokens: Int, val instruction: String
) {
    FAST("Fast", "Quick direct answers", 3, 2, 0, 768, "Give a concise direct answer with essential explanation."),
    BALANCED("Balanced", "Adaptive depth", 5, 3, 256, 1536, "Match the explanation depth to the actual question."),
    DEEP("Deep", "More evidence and reasoning", 6, 4, 768, 2304, "Explain difficult concepts carefully with relevant examples, explicit assumptions and a short verification of the conclusion. State uncertainty."),
    MAXIMUM("Maximum", "Highest bounded local effort", 8, 5, 1536, 3072, "Check the question, evidence and conclusion carefully. Explain important relationships, limitations and relevant examples. State uncertainty. Never reveal private reasoning.");

    /** Conservative ceilings; never increase a user's selected effort. */
    fun forMemory(totalBytes: Long, availableBytes: Long, lowRam: Boolean): AuEffort {
        val gib = 1024L * 1024L * 1024L
        val ceiling = when {
            lowRam || totalBytes in 1L..(6 * gib) || availableBytes in 1L..gib -> FAST
            totalBytes in 1L..(8 * gib) || availableBytes in 1L..(2 * gib) -> BALANCED
            else -> MAXIMUM
        }
        return entries[minOf(ordinal, ceiling.ordinal)]
    }

    fun forDevice(context: Context): AuEffort {
        val manager = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager ?: return this
        val memory = ActivityManager.MemoryInfo().also { manager.getMemoryInfo(it) }
        return forMemory(memory.totalMem, memory.availMem, manager.isLowRamDevice || memory.lowMemory)
    }

    fun thinkingBudget(modelId: String, lowRam: Boolean): Int? =
        if (modelId in setOf("gemma-4-e2b", "gemma-4-e4b"))
            if (lowRam) minOf(thinkingTokens, 512) else thinkingTokens
        else null
}
