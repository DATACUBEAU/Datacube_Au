package au.datacube.app.data.rag

/** Select a visual contract, not facts or geometry. The app owns the layout. */
internal object AuVisualPlan {
    enum class Kind { AUTO, TREE, FLOW, WORKFLOW, SKETCH, BAR, PIE, FORMULA, STEPS, MAP, PLOT, SCATTER }
    private val map = Regex("""\b(?:data map(?:ping)?|relationship map|network diagram|entity relationship|entity-relationship|dependency graph|knowledge graph|network graph|data flow diagram|schema diagram)\b""", RegexOption.IGNORE_CASE)
    private val scatter = Regex("""\b(?:scatter plot|scatter chart|scatter graph)\b""", RegexOption.IGNORE_CASE)
    private val plot = Regex("""\b(?:line chart|line graph|coordinate graph|function plot|plot(?: the)? (?:function|equation|data|points)|graph(?: the)? (?:function|equation)|(?:plot|graph)\s+y\s*=)\b""", RegexOption.IGNORE_CASE)
    private val tree = Regex("""\b(?:concept map|mind map|concept tree|hierarchy|hierarchical|tree diagram|family tree|organi[sz]ation chart)\b""", RegexOption.IGNORE_CASE)
    private val workflow = Regex("""\b(?:workflow|pipeline|system architecture)\b""", RegexOption.IGNORE_CASE)
    private val flow = Regex("""\b(?:flowchart|flow chart|process diagram|cycle diagram)\b""", RegexOption.IGNORE_CASE)
    private val bar = Regex("""\b(?:bar chart|bar graph)\b""", RegexOption.IGNORE_CASE)
    private val pie = Regex("""\b(?:pie chart|pie graph)\b""", RegexOption.IGNORE_CASE)
    private val formula = Regex("""\b(?:formula breakdown|equation breakdown|label(?:led)? formula)\b""", RegexOption.IGNORE_CASE)
    private val steps = Regex("""\b(?:step cards|step deck|guided visual tutorial)\b""", RegexOption.IGNORE_CASE)
    private val sketch = Regex("""\b(?:draw|sketch|labelled|labeled|anatomy|schematic|spatial|parallel lines|wave diagram|cell diagram)\b""", RegexOption.IGNORE_CASE)
    const val TREE = "Use [TREE] Title, then 2 to 10 rows: integer id | parent id (0 only for root) | short concept | relationship to parent. First row is root id 1, parent 0, relationship empty. Every other parent must occur earlier. Use at most four children per parent, at most three levels below root, and short distinct labels. State only supported relationships. Close with [/TREE]."
    private const val BASE = "Answer with essential explanation and a complete native visual, not a description instead of a visual. Treat visual data as declarative only; never emit executable UI. Label conceptual sketches not to scale; use only supported numerical values. Close every block. Do not invent source facts."
    private const val SKETCH = "Use [SKETCH] Title, ALT | spoken description, 1 to 20 commands, [/SKETCH]. Commands: LINE or ARROW | x1 | y1 | x2 | y2; CIRCLE | x | y | radius; RECT or ELLIPSE | x1 | y1 | x2 | y2; CURVE | x1 | y1 | cx | cy | x2 | y2; LABEL | x | y | text. Coordinates are integers 0..100, x right, y down. Keep labels short and apart. Parallel lines use equal direction vectors and distinct offsets. Use [DIAGRAM] projectile only for a conceptual ball trajectory."
    private const val FLOW = "Use [FLOW] Title, then 2 to 6 plain step lines in sequence, then [/FLOW]."
    private const val WORKFLOW = "Use [WORKFLOW] Title, then 2 to 6 stages with 1 to 3 cards separated by | per row. Optional title :: detail. At most 12 cards. Close [/WORKFLOW]."
    private const val BAR = "Use [BAR] Title (units), then 2 to 8 label | nonnegative number rows, then [/BAR]. Use actual values from the question or evidence. Never invent data."
    private const val PIE = "Use [PIE] Title, then 2 to 8 label | nonnegative number rows that share a meaningful whole, then [/PIE]. Never invent data."
    private const val FORMULA = "Use [FORMULA] Title, equation on one line, then 1 to 6 symbol | meaning rows, then [/FORMULA]."
    private const val MAP = "Use [MAP] Title, then 2 to 8 NODE | id | label rows, followed by 1 to 12 EDGE | fromId | toId | relationship rows. IDs are short unique ASCII identifiers. Declare all nodes before edges. All nodes must connect; no self edges. Keep labels short. Edges are directed and must reflect actual relationships; cycles are allowed. Close [/MAP]."
    private const val PLOT = "Use [PLOT] Title, AXES | horizontal axis and units | vertical axis and units, then 2 to 32 x | y rows in strictly increasing x order, then [/PLOT]. Signed finite values permitted. Use actual supplied or correctly derived values; do not invent observations. Explain if values are illustrative."
    private const val SCATTER = "Use [SCATTER] Title, AXES | horizontal axis and units | vertical axis and units, then 2 to 32 x | y rows, then [/SCATTER]. Signed finite values permitted. Use actual supplied values; do not invent observations or infer causation from correlation."
    private const val STEPS = "Use [STEPS] Title, 2 to 6 [STEP] Title lines each followed by a short explanation, then [/STEPS]. No nested step decks."
    fun kind(question: String): Kind = when {
        map.containsMatchIn(question) -> Kind.MAP
        scatter.containsMatchIn(question) -> Kind.SCATTER
        plot.containsMatchIn(question) -> Kind.PLOT
        tree.containsMatchIn(question) -> Kind.TREE
        pie.containsMatchIn(question) -> Kind.PIE
        bar.containsMatchIn(question) -> Kind.BAR
        formula.containsMatchIn(question) -> Kind.FORMULA
        workflow.containsMatchIn(question) -> Kind.WORKFLOW
        flow.containsMatchIn(question) -> Kind.FLOW
        steps.containsMatchIn(question) -> Kind.STEPS
        sketch.containsMatchIn(question) -> Kind.SKETCH
        else -> Kind.AUTO
    }
    /** Conservative optional visuals for explanatory questions without explicit diagram requests. */
    fun optionalInstruction(question: String?): String? {
        val q = question.orEmpty()
        if (AuTeachingPolicy.plan(q).visual != AuTeachingPolicy.Visual.AUTO) return null
        if (!Regex("""\b(?:explain|describe|teach|how does|how do|how is|how are)\b""", RegexOption.IGNORE_CASE).containsMatchIn(q)) return null
        val contract = when {
            Regex("""\b(?:process|stages|steps|cycle|sequence)\b""", RegexOption.IGNORE_CASE).containsMatchIn(q) -> FLOW
            Regex("""\b(?:classification|categories|types of|parts of|structure of)\b""", RegexOption.IGNORE_CASE).containsMatchIn(q) -> TREE
            Regex("""\b(?:equation|formula)\b""", RegexOption.IGNORE_CASE).containsMatchIn(q) -> FORMULA
            else -> return null
        }
        return "If a visual materially clarifies the explanation, include one complete native block after the key idea. Avoid decoration and invented source facts. " + contract
    }

    fun instruction(question: String?): String {
        AuSimulationKind.select(question)?.let { simulation ->
            return BASE + " Add exactly [SIM] " + simulation.key + " on its own line for the adjustable educational model. Explain the equation and assumptions. Starting values are illustrative, not source measurements or values provided by the user."
        }
        AuScienceTemplate.select(question)?.let { template ->
            return BASE + " For this topic use the built-in general educational illustration. On its own line emit exactly [SCIENCE] " + template.key + ". Do not draw raw commands or invent labels; explain how the illustration relates to the question. In document chat distinguish general illustrations from retrieved evidence."
        }
        if (question.isNullOrBlank()) return AuTeachingPolicy.VISUALS + " " + TREE + " " + MAP + " " + PLOT + " " + SCATTER
        return BASE + " " + when (kind(question)) {
            Kind.TREE -> TREE
            Kind.FLOW -> FLOW
            Kind.WORKFLOW -> WORKFLOW
            Kind.SKETCH -> SKETCH
            Kind.BAR -> BAR
            Kind.PIE -> PIE
            Kind.FORMULA -> FORMULA
            Kind.STEPS -> STEPS
            Kind.MAP -> MAP
            Kind.PLOT -> PLOT
            Kind.SCATTER -> SCATTER
            Kind.AUTO -> AuTeachingPolicy.VISUALS + " " + TREE + " " + MAP + " " + PLOT + " " + SCATTER
        }
    }
}
