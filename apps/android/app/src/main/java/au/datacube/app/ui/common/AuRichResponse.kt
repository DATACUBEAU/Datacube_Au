package au.datacube.app.ui.common

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.ClickableText
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

internal sealed interface AuResponseBlock {
    data class Science(val template: au.datacube.app.data.rag.AuScienceTemplate) : AuResponseBlock
    data class Prose(val text: String, val heading: Int = 0, val prefix: String = "") : AuResponseBlock
    data class Table(val headers: List<String>, val rows: List<List<String>>) : AuResponseBlock
    data class Code(val text: String) : AuResponseBlock
    data class Status(val kind: String, val text: String) : AuResponseBlock
    data class Callout(val title: String, val body: String) : AuResponseBlock
    data class Flow(val title: String, val steps: List<String>) : AuResponseBlock
    data class Workflow(val title: String, val stages: List<List<WorkflowNode>>) : AuResponseBlock
    data class WorkflowNode(val title: String, val detail: String)
    data class BarChart(val title: String, val rows: List<Pair<String, Double>>) : AuResponseBlock
    data class PieChart(val title: String, val rows: List<Pair<String, Double>>) : AuResponseBlock
    data object ProjectileIllustration : AuResponseBlock
    data class Sketch(val scene: AuSketchScene) : AuResponseBlock
    data class Tree(val scene: AuTreeScene) : AuResponseBlock
    data class Formula(val title: String, val equation: String, val symbols: List<Pair<String,String>>) : AuResponseBlock
    data class StepCard(val title:String,val body:String)
    data class Steps(val title:String,val pages:List<StepCard>) : AuResponseBlock
}

/** Deliberately bounded markdown subset; never executes model-generated HTML or code. */
internal object AuResponseParser {
    private fun cells(line: String): List<String> =
        line.trim().removePrefix("|").removeSuffix("|").split('|').map(String::trim)

    private fun separator(line: String): Boolean =
        line.contains('|') && cells(line).all { it.matches(Regex(":?-{3,}:?")) }

    fun parse(raw: String): List<AuResponseBlock> {
        val lines = raw.take(12_000).lines()
        val result = mutableListOf<AuResponseBlock>()
        var i = 0
        while (i < lines.size) {
            val line = lines[i].trim()
            if (line.isBlank()) { i++; continue }
            if (line.startsWith("[SCIENCE]")) {
                val template = au.datacube.app.data.rag.AuScienceTemplate.fromKey(line.removePrefix("[SCIENCE]").trim())
                if (template != null) result += AuResponseBlock.Science(template)
                else result += AuResponseBlock.Prose("This illustration is unavailable. Try another visual.")
                i++
                continue
            }
            // Unambiguous orphan drawing commands are never rendered as prose.
            if (line.matches(Regex("""^(?:ALT|LINE|ARROW|CIRCLE|RECT|ELLIPSE|CURVE|LABEL)\s*\|.*$""")) ||
                line == "[/SCIENCE]") { i++; continue }
            if (line.startsWith("\u0060\u0060\u0060")) {
                val code = mutableListOf<String>()
                i++
                while (i < lines.size && !lines[i].trim().startsWith("\u0060\u0060\u0060")) {
                    code += lines[i++]
                }
                if (i < lines.size) i++
                result += AuResponseBlock.Code(code.joinToString("\n"))
                continue
            }
            if (line.contains('|') && i + 1 < lines.size && separator(lines[i + 1])) {
                val header = cells(line)
                if (header.size in 2..8 && cells(lines[i + 1]).size == header.size) {
                    i += 2
                    val rows = mutableListOf<List<String>>()
                    while (i < lines.size && lines[i].contains('|') && cells(lines[i]).size == header.size) {
                        rows += cells(lines[i++])
                    }
                    result += AuResponseBlock.Table(header, rows)
                    continue
                }
            }
            if (line.startsWith("[STEPS] ")) {
                val end = (i+1 until minOf(lines.size,i+100)).firstOrNull { lines[it].trim()=="[/STEPS]" }
                if(end!=null) {
                    val title=line.removePrefix("[STEPS] ").trim()
                    val inner=lines.subList(i+1,end)
                    val starts=inner.indices.filter { inner[it].trim().startsWith("[STEP] ") }
                    if(title.length in 1..100 && starts.size in 2..6 && starts.firstOrNull()==0 &&
                        inner.none { it.trim().startsWith("[STEPS]") || it.trim()=="[/STEPS]" }) {
                        val pages=starts.mapIndexed { n,start ->
                            val heading=inner[start].trim().removePrefix("[STEP] ").trim()
                            val body=inner.subList(start+1,starts.getOrElse(n+1){inner.size}).joinToString("\n").trim()
                            AuResponseBlock.StepCard(heading,body)
                        }
                        if(pages.all { it.title.length in 1..80 && it.body.length in 1..1500 } &&
                            pages.sumOf { it.body.length }<=6000) {
                            result+=AuResponseBlock.Steps(title,pages)
                            i=end+1
                            continue
                        }
                    }
                }
            }
            if (line.startsWith("[FORMULA] ")) {
                val end = (i + 1 until minOf(lines.size, i + 10)).firstOrNull { lines[it].trim() == "[/FORMULA]" }
                if (end != null && end - i in 3..8) {
                    val title = line.removePrefix("[FORMULA] ").trim()
                    val equation = lines[i + 1].trim()
                    val rows = lines.subList(i + 2,end).map { it.split('|').map(String::trim) }
                    if (title.length in 1..100 && equation.length in 1..160 &&
                        !equation.contains('[') && !equation.contains(']') && !equation.contains('|') &&
                        rows.all { it.size == 2 && it[0].length in 1..24 && it[1].length in 1..140 &&
                            it.none { part -> part.contains('[') || part.contains(']') } } &&
                        rows.map { it[0] }.distinct().size == rows.size) {
                        result += AuResponseBlock.Formula(title,equation,rows.map { it[0] to it[1] })
                        i = end + 1
                        continue
                    }
                }
            }
            if (line.startsWith("[TREE] ")) {
                val end = (i + 1 until minOf(lines.size, i + 12)).firstOrNull { lines[it].trim() == "[/TREE]" }
                if (end != null) {
                    val scene = AuTreeParser.parse(line.removePrefix("[TREE] "), lines.subList(i + 1, end))
                    if (scene != null) {
                        result += AuResponseBlock.Tree(scene)
                        i = end + 1
                        continue
                    }
                }
            }
            if (line.startsWith("[SKETCH] ")) {
                val end = (i + 1 until minOf(lines.size, i + 24)).firstOrNull { lines[it].trim() == "[/SKETCH]" }
                if (end != null) {
                    val scene = AuSketchParser.parse(line.removePrefix("[SKETCH] "), lines.subList(i + 1,end))
                    if (scene != null) {
                        result += AuResponseBlock.Sketch(scene)
                        i = end + 1
                        continue
                    }
                }
            }
            // Older models emit [DIAGRAM] instead of [SKETCH], sometimes with trailing separators.
            // Normalize valid legacy sketches; do not expose drawing commands as prose.
            if (line.startsWith("[DIAGRAM] ") && line != "[DIAGRAM] projectile") {
                val end = (i + 1 until minOf(lines.size, i + 60)).firstOrNull { lines[it].trim() == "[/DIAGRAM]" }
                val headingParts = line.removePrefix("[DIAGRAM] ").split('|').map(String::trim)
                val title = headingParts.first().take(100)
                val description = headingParts.getOrNull(1)?.take(400).orEmpty().ifBlank { title }
                if (end != null) {
                    val commands = lines.subList(i + 1, end).map { it.trim().trimEnd('|').trim() }.filter(String::isNotBlank)
                    val alt = if (commands.firstOrNull()?.startsWith("ALT |") == true) commands
                        else listOf("ALT | $description") + commands
                    val scene = AuSketchParser.parse(title, alt)
                    if (scene != null) result += AuResponseBlock.Sketch(scene)
                    else result += AuResponseBlock.Prose(description)
                    i = end + 1
                } else {
                    // Streaming block is not ready. Preserve earlier prose, wait for its closing marker.
                    break
                }
                continue
            }
            // Only an exact allowlisted schematic is recognized; no generated coordinates or code.
            if (line == "[DIAGRAM] projectile") {
                result += AuResponseBlock.ProjectileIllustration
                i++
                continue
            }
            // Each workflow row is one stage; sibling cards are separated by a pipe.
            // Bound the layout and accept only plain text nodes, never executable UI.
            if (line.startsWith("[WORKFLOW] ")) {
                val end = (i + 1 until minOf(lines.size, i + 30)).firstOrNull { lines[it].trim() == "[/WORKFLOW]" }
                if (end != null) {
                    val title = line.removePrefix("[WORKFLOW] ").trim()
                    val stages = lines.subList(i + 1, end).filter { it.isNotBlank() }.map { row ->
                        row.split('|').map { cell ->
                            val parts = cell.split("::", limit = 2)
                            AuResponseBlock.WorkflowNode(parts.first().trim(), parts.getOrNull(1)?.trim().orEmpty())
                        }
                    }
                    val valid = stages.size in 2..6 && stages.sumOf { it.size } <= 12 &&
                        stages.all { row -> row.size in 1..3 && row.all { node ->
                            node.title.length in 1..80 && node.detail.length <= 120 &&
                                listOf(node.title, node.detail).none { it.contains("[WORKFLOW]") || it.contains("[/WORKFLOW]") }
                        } }
                    if (title.length in 1..100 && valid) result += AuResponseBlock.Workflow(title, stages)
                    else result += AuResponseBlock.Prose(title)
                    i = end + 1
                    continue
                } else break
            }
            // Only a small, complete, declarative flow is accepted. No HTML, URLs or scripts.
            if (line.startsWith("[FLOW] ")) {
                val end = (i + 1 until minOf(lines.size, i + 9)).firstOrNull { lines[it].trim() == "[/FLOW]" }
                if (end != null) {
                    val title = line.removePrefix("[FLOW] ").trim()
                    val steps = lines.subList(i + 1, end).map(String::trim).filter(String::isNotBlank)
                    if (title.length in 1..100 && steps.size in 2..6 && steps.all { it.length in 1..120 && !it.contains("[FLOW]") && !it.contains("[/FLOW]") }) {
                        result += AuResponseBlock.Flow(title, steps)
                        i = end + 1
                        continue
                    }
                }
            }
            // Only complete, bounded numeric charts are eligible for native rendering.
            if (line.startsWith("[BAR] ") || line.startsWith("[PIE] ")) {
                val pie = line.startsWith("[PIE] ")
                val endTag = if (pie) "[/PIE]" else "[/BAR]"
                val end = (i + 1 until minOf(lines.size, i + 11)).firstOrNull { lines[it].trim() == endTag }
                if (end != null) {
                    val title = line.removePrefix(if (pie) "[PIE] " else "[BAR] ").trim()
                    val rows = lines.subList(i + 1, end).mapNotNull { row ->
                        val parts = row.split('|')
                        val label = parts.firstOrNull()?.trim().orEmpty()
                        val value = parts.getOrNull(1)?.trim()?.toDoubleOrNull()
                        if (parts.size == 2 && label.length in 1..64 && value != null &&
                            value.isFinite() && value in 0.0..1.0e12) label to value else null
                    }
                    if (title.length in 1..100 && rows.size in 2..8 && rows.size == end - i - 1 &&
                        rows.map { it.first }.distinct().size == rows.size && (!pie || rows.sumOf { it.second } > 0.0)) {
                        result += if (pie) AuResponseBlock.PieChart(title, rows) else AuResponseBlock.BarChart(title, rows)
                        i = end + 1
                        continue
                    }
                }
            }
            // Bounded, declarative visual box. No executable model-generated UI.
            if (line.startsWith("[BOX] ")) {
                val title = line.removePrefix("[BOX] ").take(120)
                val end = (i + 1 until minOf(lines.size, i + 31)).firstOrNull { lines[it].trim() == "[/BOX]" }
                if (end != null) {
                    result += AuResponseBlock.Callout(title, lines.subList(i + 1, end).joinToString("\n").take(3000))
                    i = end + 1
                    continue
                }
            }
            // A malformed declarative block is not plain text. Skip its commands
            // and retain the rest of the response, rather than exposing internals.
            val invalidVisual = Regex("""^\[(DIAGRAM|SKETCH|WORKFLOW|FLOW|BOX|BAR|PIE|FORMULA|TREE|STEPS)](?:.*)$""")
                .matchEntire(line)?.groupValues?.get(1)
            if (invalidVisual != null) {
                val close = (i + 1 until lines.size).firstOrNull { lines[it].trim() == "[/" + invalidVisual + "]" }
                // A callout contains prose, not drawing instructions. On a
                // finished or restored answer keep its readable body even if
                // the model omitted the closing marker.
                if (invalidVisual == "BOX" && close == null) {
                    val title = line.substringAfter(']').trim().take(120)
                    if (title.isNotBlank()) result += AuResponseBlock.Prose(title, heading = 3)
                    for (bodyLine in lines.drop(i + 1)) {
                        val body = bodyLine.trim()
                        if (body.startsWith("[") || body.contains('|') || body.startsWith("```")) break
                        if (body.isNotBlank()) result += AuResponseBlock.Prose(body)
                    }
                    break
                }
                if (close == null) break
                val title = line.substringAfter(']').trim().substringBefore('|').take(100)
                result += AuResponseBlock.Prose(if (title.isBlank()) "Visual could not be rendered." else "$title — visual could not be rendered.")
                i = close + 1
                continue
            }
            if (line.matches(Regex("^\\[/?(?:DIAGRAM|SKETCH|WORKFLOW|FLOW|BOX|BAR|PIE|FORMULA|TREE|STEPS|STEP)](?:.*)$"))) {
                i++
                continue
            }
            val heading = Regex("^(#{1,6})\\s*(\\S.+|\\S)$").matchEntire(line)
            val bullet = Regex("^([-*+•]|\\d+[.)])\\s+(.+)$").matchEntire(line)
            val status = Regex("^\\[(OK|WARN|ERROR)]\\s+(.+)$").matchEntire(line)
            result += when {
                heading != null -> AuResponseBlock.Prose(heading.groupValues[2], heading.groupValues[1].length)
                bullet != null -> AuResponseBlock.Prose(bullet.groupValues[2], prefix =
                    if (bullet.groupValues[1] in listOf("-", "*", "+", "•")) "• " else bullet.groupValues[1].trimEnd(')', '.') + ". ")
                status != null -> AuResponseBlock.Status(status.groupValues[1], status.groupValues[2])
                else -> AuResponseBlock.Prose(line)
            }
            i++
        }
        return result
    }
}

private fun inlineText(text: String): AnnotatedString = buildAnnotatedString {
    val pattern = Regex("\\*\\*(.+?)\\*\\*|\\x60([^\\x60]+)\\x60")
    var end = 0
    pattern.findAll(text).forEach { match ->
        append(text.substring(end, match.range.first))
        if (match.groupValues[1].isNotEmpty()) withStyle(SpanStyle(fontWeight = FontWeight.Bold)) {
            append(match.groupValues[1])
        } else withStyle(SpanStyle(fontFamily = FontFamily.Monospace)) {
            append(match.groupValues[2])
        }
        end = match.range.last + 1
    }
    append(text.substring(end))
}

/**
 * Cache only definitely closed, ordinary prose lines. Anything containing a
 * table, fence, or native directive stays in the reparsed suffix. A changed
 * prefix invalidates the cache (for example when retrieval switches to fallback).
 */
internal class AuIncrementalResponseParser {
    private var prefix = ""
    private val stable = mutableListOf<AuResponseBlock>()

    fun parse(answer: String): List<AuResponseBlock> {
        val bounded = answer.take(12_000)
        if (!bounded.startsWith(prefix)) {
            prefix = ""
            stable.clear()
        }
        var offset = prefix.length
        while (offset < bounded.length) {
            val end = bounded.indexOf('\n', offset)
            if (end < 0) break
            val candidate = bounded.substring(offset, end + 1)
            if (candidate.lineSequence().any { line ->
                    val text = line.trim()
                    text.startsWith("[") || text.startsWith("\u0060\u0060\u0060") || '|' in text
                }) break
            stable += AuResponseParser.parse(candidate)
            offset = end + 1
        }
        prefix = bounded.substring(0, offset)
        return stable.toList() + AuResponseParser.parse(bounded.substring(offset))
    }
}

@Composable
internal fun AuRichResponse(answer: String, streaming: Boolean = false, onTextClick: ((String, Int) -> Unit)? = null) {
    val incrementalParser = remember { AuIncrementalResponseParser() }
    val blocks = remember(answer) { incrementalParser.parse(answer) }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        blocks.forEachIndexed { blockIndex, block ->
            androidx.compose.runtime.key(blockIndex, block::class) {
            when (block) {
                is AuResponseBlock.Prose -> {
                    val style = when (block.heading) {
                        1, 2 -> MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.SemiBold, lineHeight = 28.sp)
                        3, 4, 5, 6 -> MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold, lineHeight = 24.sp)
                        else -> MaterialTheme.typography.bodyLarge.copy(lineHeight = 25.sp)
                    }
                    val annotated = remember(block) { inlineText(block.text) }
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.Top) {
                        if (block.prefix.isNotBlank()) Text(block.prefix.trim(),
                            Modifier.widthIn(min = 20.dp), style = style, fontWeight = FontWeight.Medium)
                        Box(Modifier.weight(1f)) {
                            if (onTextClick != null && !streaming) ClickableText(annotated,
                                style = style.copy(color = MaterialTheme.colorScheme.onSurface),
                                onClick = { onTextClick(annotated.text, it) })
                            else if (streaming) Text(annotated, style = style)
                            else SelectionContainer { Text(annotated, style = style) }
                        }
                    }
                }
                is AuResponseBlock.Table -> Surface(
                    shape = RoundedCornerShape(12.dp),
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                    color = MaterialTheme.colorScheme.surface
                ) {
                    Column(Modifier.horizontalScroll(rememberScrollState())) {
                        (listOf(block.headers) + block.rows).forEachIndexed { index, row ->
                            Row(Modifier.background(if (index == 0) MaterialTheme.colorScheme.surfaceVariant
                                else MaterialTheme.colorScheme.surface)) {
                                row.forEach { cell ->
                                    Box(Modifier.width(148.dp).padding(10.dp)) {
                                        val kind = when (cell.trim().removeSurrounding("**").lowercase()) {
                                            "passed", "success", "verified", "complete" -> "OK"
                                            "failed", "error", "missing" -> "ERROR"
                                            "pending", "warning" -> "WARN"
                                            else -> null
                                        }
                                        if (index > 0 && kind != null) StatusText(kind, cell.removeSurrounding("**"))
                                        else Text(inlineText(cell), style = MaterialTheme.typography.bodySmall,
                                            fontWeight = if (index == 0) FontWeight.Bold else FontWeight.Normal)
                                    }
                                }
                            }
                            if (index < block.rows.size) HorizontalDivider()
                        }
                    }
                }
                is AuResponseBlock.Code -> Surface(
                    shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.surfaceVariant
                ) {
                    SelectionContainer {
                        Text(block.text, Modifier.horizontalScroll(rememberScrollState()).padding(12.dp),
                            fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall)
                    }
                }
                is AuResponseBlock.Status -> StatusText(block.kind, block.text)
                is AuResponseBlock.Flow -> Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(14.dp),
                    color = MaterialTheme.colorScheme.surface,
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)
                ) {
                    Column(Modifier.padding(14.dp), horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(5.dp)) {
                        Text(inlineText(block.title), style = MaterialTheme.typography.titleSmall,
                            modifier = Modifier.fillMaxWidth(), fontWeight = FontWeight.SemiBold)
                        Spacer(Modifier.height(3.dp))
                        block.steps.forEachIndexed { index, step ->
                            if (index > 0) Text("↓", color = MaterialTheme.colorScheme.onSurfaceVariant,
                                style = MaterialTheme.typography.titleMedium)
                            Surface(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(10.dp),
                                color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.55f)) {
                                Row(Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                    Text((index + 1).toString(), color = MaterialTheme.colorScheme.primary,
                                        fontWeight = FontWeight.SemiBold)
                                    SelectionContainer { Text(inlineText(step), style = MaterialTheme.typography.bodyMedium) }
                                }
                            }
                        }
                    }
                }
                is AuResponseBlock.Tree -> AuConceptTree(block.scene)
                is AuResponseBlock.Workflow -> Column(
                    Modifier.fillMaxWidth(),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text(inlineText(block.title), style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold, modifier = Modifier.fillMaxWidth())
                    block.stages.forEachIndexed { index, stage ->
                        if (index > 0) Text("↓", style = MaterialTheme.typography.titleLarge,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp),
                            verticalAlignment = Alignment.CenterVertically) {
                            stage.forEach { node ->
                                Surface(Modifier.weight(1f), shape = RoundedCornerShape(14.dp),
                                    color = when (index) {
                                        0 -> MaterialTheme.colorScheme.primaryContainer
                                        1 -> MaterialTheme.colorScheme.secondaryContainer
                                        else -> MaterialTheme.colorScheme.tertiaryContainer
                                    },
                                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
                                    Column(Modifier.padding(if (stage.size > 1) 8.dp else 14.dp),
                                        horizontalAlignment = Alignment.CenterHorizontally,
                                        verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                        Text(inlineText(node.title), fontWeight = FontWeight.SemiBold,
                                            style = if (stage.size > 1) MaterialTheme.typography.titleSmall else MaterialTheme.typography.titleMedium,
                                            textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                                        if (node.detail.isNotBlank()) Text(inlineText(node.detail),
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                                    }
                                }
                            }
                        }
                    }
                }
                is AuResponseBlock.BarChart -> Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(14.dp),
                    color = MaterialTheme.colorScheme.surface,
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)
                ) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text(inlineText(block.title), style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.SemiBold)
                        val maximum = block.rows.maxOf { it.second }.coerceAtLeast(0.000000001)
                        block.rows.forEach { (label, value) ->
                            Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
                                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                    Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
                                    Text(value.toString().removeSuffix(".0"), style = MaterialTheme.typography.labelMedium)
                                }
                                LinearProgressIndicator(progress = { (value / maximum).toFloat().coerceIn(0f, 1f) },
                                    modifier = Modifier.fillMaxWidth().height(9.dp),
                                    trackColor = MaterialTheme.colorScheme.surfaceVariant)
                            }
                        }
                    }
                }
                is AuResponseBlock.PieChart -> {
                    val colors = listOf(Color(0xFF2563EB), Color(0xFF0891B2), Color(0xFF64748B),
                        Color(0xFF0F766E), Color(0xFF93C5FD), Color(0xFF475569), Color(0xFF60A5FA), Color(0xFF334155))
                    val total = block.rows.sumOf { it.second }
                    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(inlineText(block.title), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                        Canvas(Modifier.size(160.dp).align(Alignment.CenterHorizontally)) {
                            var start = -90f
                            block.rows.forEachIndexed { index, row ->
                                val sweep = (360.0 * row.second / total).toFloat()
                                if (sweep > 0f) drawArc(colors[index], start, sweep, useCenter = true)
                                start += sweep
                            }
                        }
                        block.rows.forEachIndexed { index, (label, value) ->
                            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Box(Modifier.size(12.dp).background(colors[index], RoundedCornerShape(3.dp)))
                                Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
                                Text(value.toString().removeSuffix(".0"), style = MaterialTheme.typography.labelMedium)
                            }
                        }
                    }
                }
                is AuResponseBlock.Science -> AuScienceVisual(block.template)
                AuResponseBlock.ProjectileIllustration -> AuProjectileIllustration()
                is AuResponseBlock.Sketch -> AuSketchIllustration(block.scene)
                is AuResponseBlock.Steps -> AuStepDeck(block)
                is AuResponseBlock.Formula -> Surface(
                    modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(14.dp),
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)
                ) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(block.title, style = MaterialTheme.typography.titleMedium)
                        SelectionContainer {
                            Text(block.equation, Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(vertical = 6.dp),
                                style = MaterialTheme.typography.headlineSmall, color = MaterialTheme.colorScheme.primary)
                        }
                        block.symbols.forEach { (symbol,meaning) ->
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                Text(symbol, Modifier.widthIn(min=28.dp,max=88.dp), fontWeight=FontWeight.SemiBold)
                                Text(meaning, Modifier.weight(1f), style=MaterialTheme.typography.bodyMedium)
                            }
                        }
                    }
                }
                is AuResponseBlock.Callout -> Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(16.dp),
                    color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.40f),
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)
                ) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(inlineText(block.title), style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.SemiBold)
                        SelectionContainer {
                            Text(inlineText(block.body), style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                }
            }
            }
        }
    }
}

@Composable
private fun StatusText(kind: String, text: String) {
    val tint = when (kind) {
        "OK" -> Color(0xFF239A75)
        "ERROR" -> MaterialTheme.colorScheme.error
        else -> Color(0xFFB98124)
    }
    Surface(shape = RoundedCornerShape(9.dp), color = tint.copy(alpha = 0.16f),
        border = BorderStroke(1.dp, tint.copy(alpha = 0.45f))) {
        Text(inlineText(text), Modifier.padding(horizontal = 9.dp, vertical = 5.dp),
            style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurface)
    }
}
