package au.datacube.app.ui.common

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

internal data class AuTreeNode(val id: Int, val parent: Int, val title: String, val relation: String, val depth: Int)
internal data class AuTreeScene(val title: String, val nodes: List<AuTreeNode>)

internal object AuTreeParser {
    private fun validText(s: String, max: Int): Boolean =
        s.length in 1..max && s.none { it.isISOControl() || it in "[]<>" }

    fun parse(title: String, rows: List<String>): AuTreeScene? {
        if (!validText(title, 100) || rows.size !in 2..10) return null
        val nodes = linkedMapOf<Int, AuTreeNode>()
        for ((index, row) in rows.withIndex()) {
            val parts = row.split('|').map(String::trim)
            if (parts.size != 4) return null
            val id = parts[0].toIntOrNull()?.takeIf { it in 1..99 } ?: return null
            val parent = parts[1].toIntOrNull() ?: return null
            if (id in nodes || !validText(parts[2], 64) ||
                nodes.values.any { it.title.equals(parts[2], ignoreCase = true) }) return null
            val depth = if (index == 0) {
                if (id != 1 || parent != 0 || parts[3].isNotEmpty()) return null
                0
            } else {
                val ancestor = nodes[parent] ?: return null
                if (!validText(parts[3], 100) || ancestor.depth >= 3 ||
                    nodes.values.count { it.parent == parent } >= 4) return null
                ancestor.depth + 1
            }
            nodes[id] = AuTreeNode(id, parent, parts[2], parts[3], depth)
        }
        return AuTreeScene(title, nodes.values.toList())
    }
}

@Composable
internal fun AuConceptTree(scene: AuTreeScene) {
    val children = androidx.compose.runtime.remember(scene) { scene.nodes.groupBy { it.parent } }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(scene.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        ConceptBranch(scene.nodes.first(), children)
    }
}

/** Indented branch layout: app computes edges from parent IDs, not model coordinates. */
@Composable
private fun ConceptBranch(node: AuTreeNode, children: Map<Int, List<AuTreeNode>>) {
    val edge = MaterialTheme.colorScheme.outline
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Surface(Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp),
            color = when (node.depth) {
                0 -> MaterialTheme.colorScheme.primaryContainer
                1 -> MaterialTheme.colorScheme.secondaryContainer
                else -> MaterialTheme.colorScheme.tertiaryContainer
            },
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
            Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                if (node.relation.isNotBlank()) Text(node.relation, style = MaterialTheme.typography.labelSmall)
                Text(node.title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            }
        }
        val branches = children[node.id].orEmpty()
        branches.forEachIndexed { index, child ->
            Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min)) {
                Canvas(Modifier.width(16.dp).fillMaxHeight()) {
                    val x = size.width / 2
                    val y = minOf(20.dp.toPx(), size.height / 2)
                    drawLine(edge, Offset(x, 0f), Offset(x, if (index == branches.lastIndex) y else size.height), 1.5.dp.toPx())
                    drawLine(edge, Offset(x, y), Offset(size.width, y), 1.5.dp.toPx())
                }
                Box(Modifier.weight(1f)) { ConceptBranch(child, children) }
            }
        }
    }
}
