package au.datacube.app.ui.common

/** Turn only the visible final answer into natural speech, not the activity trace. */
internal object AuSpokenResponse {
    private val completeThought = Regex("(?is)<(think|thinking|analysis|reasoning)>.*?</\\1>")
    private val partialThought = Regex("(?is)<(?:think(?:ing)?|analysis|reasoning)(?:>|\\s|$).*")
    private val link = Regex("\\[([^\\]]+)]\\((?:https?://|www\\.)[^\\s)]+\\)", RegexOption.IGNORE_CASE)
    private val url = Regex("(?i)(?:https?://|www\\.)[^\\s<>]+")
    private val inlineCode = Regex("""\x60[^\x60\n]+\x60""")
    private val decorations = Regex("""[*#_~|<>\[\]{}]+""")
    private val punctuationRun = Regex("""\.{2,}|…+|[!?]{2,}""")
    private val isolatedSymbols = Regex("""(?<![\p{L}\p{N}])[\p{P}\p{S}&&[^.?!,;:]]+(?![\p{L}\p{N}])""")
    private fun plain(text: String): String =
        text.replace(inlineCode, "See the code in the response. ")
            .replace(link) { it.groupValues[1] + ". See the link in the response." }
            .replace(url, "See the URL in the response. ")
            .replace(Regex("\\[(?:\\d{1,3})]"), "")
            .replace(decorations, " ")
            .replace(Regex("\\x60+"), "")
            .replace(punctuationRun) { match ->
                when {
                    '?' in match.value -> "?"
                    '!' in match.value -> "!"
                    else -> ", "
                }
            }
            .replace(isolatedSymbols, " ")
            .replace(Regex("\\s+"), " ").trim()

    fun format(answer: String): String {
        val visible = answer.replace(completeThought, "").replace(partialThought, "")
        val blocks = AuResponseParser.parse(visible)
        var tableNumber = 0
        return buildList {
            blocks.forEach { block ->
                when (block) {
                    is AuResponseBlock.Prose -> {
                        val text = plain(block.text)
                        if (text.isNotBlank()) {
                            val number = block.prefix.trim().removeSuffix(".").removeSuffix(")").toIntOrNull()
                            add(if (number != null) "Number $number. $text" else text)
                        }
                    }
                    is AuResponseBlock.Status -> {
                        val label = when (block.kind) {
                            "OK" -> "Success"
                            "ERROR" -> "Attention"
                            else -> "Note"
                        }
                        add(label + ". " + plain(block.text))
                    }
                    is AuResponseBlock.Callout -> {
                        add(plain(block.title))
                        add(plain(block.body))
                    }
                    is AuResponseBlock.Flow -> {
                        add(plain(block.title))
                        block.steps.forEachIndexed { index, step -> add("Step ${index + 1}. " + plain(step)) }
                    }
                    is AuResponseBlock.Tree -> {
                        add(plain(block.scene.title))
                        val byId = block.scene.nodes.associateBy { it.id }
                        block.scene.nodes.forEach { node ->
                            val parent = byId[node.parent]
                            add(if (parent == null) plain(node.title)
                                else plain(parent.title) + " — " + plain(node.relation) + " — " + plain(node.title))
                        }
                    }
                    is AuResponseBlock.Workflow -> {
                        add(plain(block.title))
                        block.stages.forEachIndexed { index, stage ->
                            add("Stage " + (index + 1) + ". " + stage.joinToString(". ") { node ->
                                plain(node.title) + if (node.detail.isBlank()) "" else ": " + plain(node.detail)
                            })
                        }
                    }
                    is AuResponseBlock.BarChart -> {
                        add(plain(block.title))
                        block.rows.forEach { (label, value) -> add(plain(label) + ": " + value.toString().removeSuffix(".0")) }
                    }
                    is AuResponseBlock.PieChart -> {
                        add(plain(block.title))
                        block.rows.forEach { (label, value) -> add(plain(label) + ": " + value.toString().removeSuffix(".0")) }
                    }
                    is AuResponseBlock.Steps -> {
                        add(plain(block.title))
                        block.pages.forEachIndexed { index,page ->
                            add("Step "+(index+1)+". "+plain(page.title))
                            add(format(page.body))
                        }
                    }
                    is AuResponseBlock.Formula -> {
                        add(plain(block.title))
                        add("Formula: " + block.equation)
                        block.symbols.forEach { (symbol, meaning) -> add(symbol + " means " + plain(meaning)) }
                    }
                    is AuResponseBlock.Sketch -> {
                        add(plain(block.scene.title))
                        add(plain(block.scene.description))
                    }
                    is AuResponseBlock.Timeline -> {
                        add(plain(block.data.title))
                        block.data.events.forEach { event -> add(plain(event.time) + ": " + plain(event.event)) }
                    }
                    is AuResponseBlock.RelationshipMap -> {
                        add(plain(block.data.title))
                        val nodes=block.data.nodes.associate { it.id to it.label }
                        block.data.edges.forEach { e -> add(plain(nodes.getValue(e.from)) + " — " + plain(e.label) + " — " + plain(nodes.getValue(e.to))) }
                    }
                    is AuResponseBlock.NumericPlot -> {
                        add(plain(block.data.title))
                        add("Horizontal axis: " + plain(block.data.xLabel) + ". Vertical axis: " + plain(block.data.yLabel))
                        block.data.series.forEach { p -> add("x " + p.x + ", y " + p.y) }
                    }
                    is AuResponseBlock.Simulation -> add(plain(block.kind.description))
                    is AuResponseBlock.Science -> add(plain(block.template.description))
                    AuResponseBlock.ProjectileIllustration -> add("Illustration: a person tosses a ball. It rises, reaches its highest point, and falls under gravity. The path is schematic and not to scale.")
                    is AuResponseBlock.Code -> add("A code example is available. Look at the code block in the written response.")
                    is AuResponseBlock.Table -> {
                        tableNumber++
                        add("Here is table $tableNumber, row by row.")
                        block.rows.forEachIndexed { i, row ->
                            val contents = row.mapIndexedNotNull { column, cell ->
                                val value = plain(cell)
                                val header = plain(block.headers[column])
                                if (value.isBlank()) null else if (header.isBlank()) value else header + ": " + value
                            }.joinToString(". ")
                            if (contents.isNotBlank()) add("Row " + (i + 1) + ". " + contents + ".")
                        }
                        if (block.rows.isEmpty()) add("Columns: " + block.headers.joinToString(", ") { plain(it) })
                    }
                }
            }
        }.joinToString("\n\n")
    }
}
