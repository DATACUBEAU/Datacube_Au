package au.datacube.app.ui.common

import androidx.compose.foundation.BorderStroke
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp

internal sealed interface AuResponseBlock {
    data class Prose(val text: String, val heading: Int = 0, val prefix: String = "") : AuResponseBlock
    data class Table(val headers: List<String>, val rows: List<List<String>>) : AuResponseBlock
    data class Code(val text: String) : AuResponseBlock
    data class Status(val kind: String, val text: String) : AuResponseBlock
    data class Callout(val title: String, val body: String) : AuResponseBlock
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
            val heading = Regex("^(#{1,4})\\s+(.+)$").matchEntire(line)
            val bullet = Regex("^([-*]|\\d+[.)])\\s+(.+)$").matchEntire(line)
            val status = Regex("^\\[(OK|WARN|ERROR)]\\s+(.+)$").matchEntire(line)
            result += when {
                heading != null -> AuResponseBlock.Prose(heading.groupValues[2], heading.groupValues[1].length)
                bullet != null -> AuResponseBlock.Prose(bullet.groupValues[2], prefix =
                    if (bullet.groupValues[1] in listOf("-", "*")) "• " else bullet.groupValues[1] + " ")
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

@Composable
internal fun AuRichResponse(answer: String, onTextClick: ((String, Int) -> Unit)? = null) {
    val blocks = remember(answer) { AuResponseParser.parse(answer) }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(9.dp)) {
        blocks.forEach { block ->
            when (block) {
                is AuResponseBlock.Prose -> {
                    val style = if (block.heading > 0) MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold)
                        else MaterialTheme.typography.bodyLarge
                    val annotated = remember(block) { inlineText(block.prefix + block.text) }
                    if (onTextClick != null) {
                        ClickableText(annotated, style = style.copy(color = MaterialTheme.colorScheme.onSurface),
                            onClick = { onTextClick(annotated.text, it) })
                    } else SelectionContainer { Text(annotated, style = style) }
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
