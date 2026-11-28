package au.datacube.app.data.rag

import kotlin.math.PI
import kotlin.math.sin

/** General educational illustrations, never evidence extracted from a document. */
internal enum class AuScienceTemplate(val key: String, val title: String, val description: String) {
    PLANT_CELL("plant-cell", "Plant cell", "Simplified plant cell with cell wall, cell membrane, nucleus, chloroplasts and central vacuole."),
    WATER_CYCLE("water-cycle", "Water cycle", "Water evaporates, condenses into clouds, falls as precipitation and collects or flows back to bodies of water."),
    PARALLEL_LINES("parallel-lines", "Parallel lines", "Two distinct coplanar lines have the same direction and do not intersect."),
    SINE_WAVE("sine-wave", "Sine wave", "The graph shows sinusoidal displacement over time. Amplitude changes peak height; frequency changes cycles per second.");

    /** Only for completed general chat, not source-grounded or interrupted answers. */
    fun missingIllustration(answer: String): String? = AuVisualProtocol.missingDirective(answer,"SCIENCE",key)

    companion object {
        fun fromKey(key: String) = entries.firstOrNull { it.key == key.trim() }
        private val teach = Regex("""\b(?:explain|describe|teach|show|illustrate|draw|visuali[sz]e|how|what is|what are|diagram|visual|simulation|simulate|graph)\b""", RegexOption.IGNORE_CASE)
        private val incompatible = Regex("""\b(?:animal cell|compare|versus|vs|difference|history|quiz|exam questions?|concept map|mind map|flowchart|workflow|bar chart|pie chart|formula breakdown|data map(?:ping)?|relationship map|network diagram|scatter plot|line chart|function plot|timeline|chronology)\b""", RegexOption.IGNORE_CASE)
        private val topics = listOf(
            PLANT_CELL to Regex("""\bplant cells?\b""", RegexOption.IGNORE_CASE),
            WATER_CYCLE to Regex("""\b(?:water cycle|hydrologic(?:al)? cycle)\b""", RegexOption.IGNORE_CASE),
            PARALLEL_LINES to Regex("""\bparallel lines\b""", RegexOption.IGNORE_CASE),
            SINE_WAVE to Regex("""\b(?:sine wave|sinusoidal wave|sinusoidal oscillation)\b""", RegexOption.IGNORE_CASE)
        )
        fun select(question: String?): AuScienceTemplate? {
            val q = question?.trim()?.takeIf { it.isNotBlank() } ?: return null
            if (!teach.containsMatchIn(q) || incompatible.containsMatchIn(q)) return null
            if (AuTeachingPolicy.plan(q).visual == AuTeachingPolicy.Visual.TEXT_ONLY) return null
            return topics.filter { it.second.containsMatchIn(q) }.singleOrNull()?.first
        }
    }
}

internal data class AuWaveParameters(val amplitude: Float = 1f, val frequency: Float = 2f) {
    init {
        require(amplitude.isFinite() && amplitude in .5f..2f)
        require(frequency.isFinite() && frequency in 1f..4f)
    }
    fun displacement(seconds: Double): Double {
        require(seconds.isFinite() && seconds in 0.0..1.0)
        return amplitude * sin(2 * PI * frequency * seconds)
    }
}
