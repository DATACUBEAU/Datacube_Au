package au.datacube.app.data.rag

/** A single teaching and visual contract, shared by chat and study generation. */
internal object AuTeachingPolicy {
    enum class Level { AUTO, SIMPLE, ADVANCED, BRIEF }
    enum class Subject { GENERAL, MATHEMATICS, PHYSICS, BIOLOGY, CHEMISTRY, ENGINEERING }
    enum class Visual { AUTO, REQUESTED, TEXT_ONLY }

    private val simple = Regex("""\b(?:beginner|newbie|simplif\w*|plain english|simple terms|easy to understand|break (?:it|this|the document) down|(?:i (?:am|'m)|like i am|like i'm)\s+(?:a )?(?:three|five|[35])(?:\s+years? old)?|i (?:don't|do not) understand)\b""",RegexOption.IGNORE_CASE)
    private val advanced = Regex("""\b(?:advanced|technical detail|expert level|rigorous|derive formally|university level)\b""",RegexOption.IGNORE_CASE)
    private val brief = Regex("""\b(?:briefly|quick answer|one sentence|short answer|keep it short)\b""",RegexOption.IGNORE_CASE)
    private val textOnly = Regex("""\b(?:no (?:visuals?|diagrams?|illustrations?)|(?:without|don't use|do not use) (?:any )?(?:visuals?|diagrams?|illustrations?)|text only)\b""",RegexOption.IGNORE_CASE)
    private val visual = Regex("""\b(?:draw|illustrate|sketch|visuali[sz]e|(?:show|use|include|give|make|create|with) (?:me )?(?:a |an )?(?:visual|diagram|illustration|graph|chart))\b""",RegexOption.IGNORE_CASE)
    private val subjectWords = linkedMapOf(
        Subject.MATHEMATICS to Regex("""\b(?:math(?:ematics)?|algebra|calculus|integral|derivative|geometry|quadratic|trigonometry|matrix|equation|statistics)\b""",RegexOption.IGNORE_CASE),
        Subject.PHYSICS to Regex("""\b(?:physics|velocity|acceleration|projectile|force|momentum|gravity|optics|kinematics|thermodynamics)\b""",RegexOption.IGNORE_CASE),
        Subject.BIOLOGY to Regex("""\b(?:biology|cell|cells|genetics|photosynthesis|mitosis|anatomy|physiology|ecosystem|dna)\b""",RegexOption.IGNORE_CASE),
        Subject.CHEMISTRY to Regex("""\b(?:chemistry|molecule|molecules|stoichiometry|molar|chemical|covalent|ionic|reaction)\b""",RegexOption.IGNORE_CASE),
        Subject.ENGINEERING to Regex("""\b(?:engineering|circuit|circuits|mechanism|mechanical|electrical|control system|beam|actuator|compressor)\b""",RegexOption.IGNORE_CASE)
    )
    data class Plan(val level:Level,val subject:Subject,val visual:Visual) {
        fun instruction():String = buildString {
            append(when(level) {
                Level.AUTO -> "Match the explanation to the person's actual question and knowledge."
                Level.SIMPLE -> "Start with the simplest correct idea; define unfamiliar terms and build up in small steps."
                Level.ADVANCED -> "Use appropriate technical vocabulary, assumptions, derivations and limitations."
                Level.BRIEF -> "Give the shortest complete answer."
            })
            append(" ")
            append(when(subject) {
                Subject.GENERAL -> "Choose a useful teaching approach for the subject."
                Subject.MATHEMATICS -> "Show the given values, symbol meanings, each essential algebraic step and a check."
                Subject.PHYSICS -> "Connect equations to physical intuition; state units, directions and assumptions."
                Subject.BIOLOGY -> "Connect structures to functions; show stages or labelled anatomy where helpful."
                Subject.CHEMISTRY -> "Explain particles, bonds, quantities and reaction conditions; conserve atoms and charge."
                Subject.ENGINEERING -> "Describe components, inputs, outputs, constraints and the system's behavior."
            })
            append(" ")
            append(when(visual) {
                Visual.AUTO -> "Include a visual automatically only if it adds understanding."
                Visual.REQUESTED -> "Include a suitable supported visual if possible, not merely an offer to draw it."
                Visual.TEXT_ONLY -> "Use text only; omit visual blocks."
            })
        }
    }
    fun plan(question:String,title:String=""):Plan {
        val q=question.take(1200)
        val level=when { brief.containsMatchIn(q)->Level.BRIEF; simple.containsMatchIn(q)->Level.SIMPLE; advanced.containsMatchIn(q)->Level.ADVANCED;else->Level.AUTO }
        fun detect(s:String):Subject {
            val ranked=subjectWords.map { (subject,regex)->subject to regex.findAll(s).map { it.value.lowercase() }.distinct().count() }.sortedByDescending { it.second }
            return if(ranked.first().second>0 && ranked.first().second>ranked[1].second) ranked.first().first else Subject.GENERAL
        }
        val subject=detect(q).let { if(it==Subject.GENERAL) detect(title.take(160)) else it }
        val visuals=when { textOnly.containsMatchIn(q)->Visual.TEXT_ONLY; visual.containsMatchIn(q)->Visual.REQUESTED;else->Visual.AUTO }
        return Plan(level,subject,visuals)
    }

    const val LANGUAGE = "Use natural, plain language with varied sentence lengths. Put the answer first. Define necessary technical terms without removing precision. Avoid filler, jargon for its own sake, robotic repetition and unnecessary follow-up questions. Explain difficult ideas in logical steps, with clearly labelled illustrative examples. Honor the requested audience and response length. Continue the actual prior topic; do not repeat completed material or invent memory. When asked to choose, choose a reasonable next step and say why briefly. Offer a next learning step only when useful. Distinguish source-supported facts from explanations and assumptions."

    const val VISUALS = "Use a visual only when it improves comprehension: a formula breakdown, labelled structure, process, spatial relation or meaningful comparison. Prefer one useful visual to several decorative ones. Explicit requests for visuals take priority; respect text-only requests. Use plain Markdown for ordinary prose. Allowed native blocks: [STEPS] Title, then 2 to 6 [STEP] Title lines, each followed by its short explanation (and at most one supported diagram or formula when useful), then [/STEPS]. Use this for guided tutorials or worked examples when the user benefits from one step at a time. Never nest step decks. Ordinary questions do not need cards. [BOX] Title then text then [/BOX]; [FORMULA] Title then a single equation line, then 1 to 6 symbol | meaning lines, then [/FORMULA]; [FLOW] Title then 2 to 6 step lines then [/FLOW]; [WORKFLOW] Title then 2 to 6 stages of 1 to 3 cards separated by |, each title optionally followed by :: detail, then [/WORKFLOW] (at most 12 cards); [BAR] or [PIE] Title then 2 to 8 label | nonnegative number lines, then matching closing tag. Only supported numeric values; pie parts must share a whole. [DIAGRAM] projectile is a built-in ball-trajectory illustration. For other subjects use [SKETCH] Title, ALT | a spoken description, 1 to 20 commands, [/SKETCH]. Commands: LINE or ARROW | x1 | y1 | x2 | y2; CIRCLE | x | y | radius; RECT or ELLIPSE | x1 | y1 | x2 | y2; CURVE | x1 | y1 | cx | cy | x2 | y2; LABEL | x | y | text. Coordinates are integers 0 to 100, x right, y down. Keep labels short and separated. For parallel lines, use identical direction vectors for both LINE commands with distinct offsets (for example LINE | 12 | 70 | 72 | 30 and LINE | 24 | 88 | 84 | 48); do not draw intersecting lines. For exact numeric graphs explain coordinates in text. Sketches are conceptual, not to scale. Do not invent values, use executable code, or claim an illustration proves a fact. Close every block. Keep explanations readable without a diagram."
}
