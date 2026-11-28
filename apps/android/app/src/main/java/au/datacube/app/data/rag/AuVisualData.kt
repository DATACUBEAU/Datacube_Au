package au.datacube.app.data.rag

internal data class AuMapNode(val id: String, val label: String)
internal data class AuMapEdge(val from: String, val to: String, val label: String)
internal data class AuMapData(val title: String, val nodes: List<AuMapNode>, val edges: List<AuMapEdge>)
internal data class AuPlotPoint(val x: Double, val y: Double)
internal data class AuPlotData(val title: String, val xLabel: String, val yLabel: String, val series: List<AuPlotPoint>, val scatter: Boolean)

internal object AuVisualData {
    private fun text(s: String, limit: Int) = s.length in 1..limit && s.none { it.isISOControl() || it in "[]<>|" }
    private val identifier = Regex("[A-Za-z][A-Za-z0-9_-]{0,11}")
    fun map(title: String, rows: List<String>): AuMapData? {
        if (!text(title,100) || rows.size !in 3..26) return null
        val nodes = linkedMapOf<String, AuMapNode>()
        val edges = mutableListOf<AuMapEdge>()
        for (row in rows) {
            val p = row.split('|').map(String::trim)
            when (p.firstOrNull()) {
                "NODE" -> {
                    if (p.size != 3 || !identifier.matches(p[1]) || !text(p[2],36) || p[1] in nodes || nodes.size >= 8) return null
                    nodes[p[1]] = AuMapNode(p[1],p[2])
                }
                "EDGE" -> {
                    if (p.size != 4 || p[1] !in nodes || p[2] !in nodes || p[1] == p[2] || !text(p[3],64) || edges.size >= 12) return null
                    if (edges.any { it.from == p[1] && it.to == p[2] }) return null
                    edges += AuMapEdge(p[1],p[2],p[3])
                }
                else -> return null
            }
        }
        if (nodes.size < 2 || edges.isEmpty() || nodes.keys.any { id -> edges.none { it.from == id || it.to == id } }) return null
        return AuMapData(title,nodes.values.toList(),edges.toList())
    }
    fun plot(title: String, rows: List<String>, scatter: Boolean): AuPlotData? {
        if (!text(title,100) || rows.size !in 3..33) return null
        val axis = rows.first().split('|').map(String::trim)
        if (axis.size != 3 || axis[0] != "AXES" || !text(axis[1],50) || !text(axis[2],50)) return null
        val points = rows.drop(1).map { row ->
            val p = row.split('|').map(String::trim)
            if (p.size != 2) return null
            val x = p[0].toDoubleOrNull()?.takeIf { it.isFinite() && it in -1e12..1e12 } ?: return null
            val y = p[1].toDoubleOrNull()?.takeIf { it.isFinite() && it in -1e12..1e12 } ?: return null
            AuPlotPoint(x,y)
        }
        if (!scatter && points.zipWithNext().any { (a,b) -> b.x <= a.x }) return null
        return AuPlotData(title,axis[1],axis[2],points,scatter)
    }
}

internal enum class AuSimulationKind(val key: String, val title: String, val description: String) {
    QUADRATIC("quadratic","Quadratic function","Explore how coefficients change a parabola. The curve is calculated directly from y = ax² + bx + c."),
    PENDULUM("pendulum","Simple pendulum","An ideal small-angle pendulum: period depends on length and gravitational acceleration, neglecting friction.");
    companion object {
        fun fromKey(key: String) = entries.firstOrNull { it.key == key.trim() }
        fun select(question: String?): AuSimulationKind? {
            val q=question.orEmpty()
            if (AuTeachingPolicy.plan(q).visual == AuTeachingPolicy.Visual.TEXT_ONLY) return null
            if (Regex("""\b(?:compare|versus|quiz|exam|concept map|mind map|flowchart|data map|scatter plot|bar chart|pie chart)\b""",RegexOption.IGNORE_CASE).containsMatchIn(q)) return null
            // Fixed numerical requests must use their actual values, not default controls.
            if (q.any(Char::isDigit) || '=' in q) return null
            if (!Regex("""\b(?:explain|describe|teach|simulate|simulation|interactive|show|visuali[sz]e|how does|what is|draw)\b""",RegexOption.IGNORE_CASE).containsMatchIn(q)) return null
            val quadratic=Regex("""\b(?:quadratic functions?|quadratic graph|parabolas?)\b""",RegexOption.IGNORE_CASE).containsMatchIn(q)
            val pendulum=Regex("""\b(?:simple pendulum|pendulum motion|pendulum period|pendulum simulation)\b""",RegexOption.IGNORE_CASE).containsMatchIn(q)
            return when { quadratic && !pendulum -> QUADRATIC; pendulum && !quadratic -> PENDULUM; else -> null }
        }
    }
}

internal data class AuQuadratic(val a: Double = 1.0, val b: Double = 0.0, val c: Double = 0.0) {
    init { require(a.isFinite() && a in -3.0..3.0 && b.isFinite() && b in -4.0..4.0 && c.isFinite() && c in -5.0..5.0) }
    fun y(x: Double): Double { require(x.isFinite() && x in -5.0..5.0); return a*x*x+b*x+c }
    fun plot() = AuPlotData("y = ax² + bx + c","x","y",List(81) { i -> val x=-5.0+i/8.0; AuPlotPoint(x,y(x)) },false)
}

internal data class AuPendulum(val length: Double = 1.0, val gravity: Double = 9.81) {
    init { require(length.isFinite() && length in .25..3.0 && gravity.isFinite() && gravity in 1.0..20.0) }
    val period: Double get() = 2*kotlin.math.PI*kotlin.math.sqrt(length/gravity)
    fun angle(time: Double): Double { require(time.isFinite() && time in 0.0..10.0); return .15*kotlin.math.cos(2*kotlin.math.PI*time/period) }
    fun plot() = AuPlotData("Angular displacement (small-angle approximation)","Time (s)","Angle (rad)",List(161) { i -> val t=i/16.0; AuPlotPoint(t,angle(t)) },false)
}
