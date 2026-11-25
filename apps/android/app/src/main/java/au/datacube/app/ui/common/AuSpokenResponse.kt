package au.datacube.app.ui.common

/** Turn only the visible final answer into natural speech, not the activity trace. */
internal object AuSpokenResponse {
    private val completeThought = Regex("(?is)<(think|thinking|analysis|reasoning)>.*?</\\1>")
    private val partialThought = Regex("(?is)<(?:think(?:ing)?|analysis|reasoning)(?:>|\\s|$).*")
    private val link = Regex("\\[([^\\]]+)]\\((?:https?://|www\\.)[^\\s)]+\\)", RegexOption.IGNORE_CASE)
    private val url = Regex("(?i)(?:https?://|www\\.)[^\\s<>]+")
    private fun plain(text: String): String =
        text.replace(link) { it.groupValues[1] + " (link in the response)" }
            .replace(url, "link in the response")
            .replace(Regex("\\[(?:\\d{1,3})]"), "")
            .replace(Regex("[*\\x60_]+"), "")
            .replace(Regex("\\s+"), " ").trim()

    fun format(answer: String): String {
        val visible = answer.replace(completeThought, "").replace(partialThought, "")
        val blocks = AuResponseParser.parse(visible)
        return buildList {
            blocks.forEach { block ->
                when (block) {
                    is AuResponseBlock.Prose -> {
                        val text = plain(block.text)
                        if (text.isNotBlank()) add(text)
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
                    is AuResponseBlock.Code -> add("A code example is available in the written response.")
                    is AuResponseBlock.Table -> {
                        add("Here is the table, row by row.")
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
        }.joinToString("\n").take(12_000)
    }
}
