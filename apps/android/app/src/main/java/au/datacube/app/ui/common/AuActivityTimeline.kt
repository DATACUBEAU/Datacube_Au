package au.datacube.app.ui.common

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Circle
import androidx.compose.material.icons.outlined.FactCheck
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import kotlinx.coroutines.delay
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

/**
 * Categorizes observed retrieval events, never model-private reasoning.
 * These labels must not be presented as unobserved agent actions.
 */
internal enum class AuActivityKind { SEARCH, EVIDENCE, ANSWER, ERROR, OTHER }

internal fun classifyAuActivity(event: String): AuActivityKind = when {
    listOf("fail", "error", "could not", "interrupted")
        .any { event.contains(it, ignoreCase = true) } -> AuActivityKind.ERROR
    listOf("search", "index", "rank", "bm25", "vector", "semantic", "retriev")
        .any { event.contains(it, ignoreCase = true) } -> AuActivityKind.SEARCH
    listOf("source", "passage", "excerpt", "evidence", "filter", "ground")
        .any { event.contains(it, ignoreCase = true) } -> AuActivityKind.EVIDENCE
    listOf("generat", "answer", "respond")
        .any { event.contains(it, ignoreCase = true) } -> AuActivityKind.ANSWER
    else -> AuActivityKind.OTHER
}

@Composable
fun AuActivityTimeline(
    steps: List<String>,
    modifier: Modifier = Modifier
) {
    if (steps.isEmpty()) return
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(20.dp),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.42f),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)
    ) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    Icons.Outlined.FactCheck,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(19.dp)
                )
                Spacer(Modifier.width(9.dp))
                Text(
                    "AU activity",
                    color = MaterialTheme.colorScheme.onSurface,
                    style = MaterialTheme.typography.titleSmall
                )
                Spacer(Modifier.weight(1f))
                Text(
                    steps.size.toString() + " recorded",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.labelSmall
                )
            }
            steps.take(16).forEach { step ->
                val kind = classifyAuActivity(step)
                val (label, icon) = when (kind) {
                    AuActivityKind.SEARCH -> "Retrieval" to Icons.Outlined.Search
                    AuActivityKind.EVIDENCE -> "Evidence" to Icons.Outlined.FactCheck
                    AuActivityKind.ANSWER -> "Response" to Icons.Outlined.ChatBubbleOutline
                    AuActivityKind.ERROR -> "Attention" to Icons.Outlined.ErrorOutline
                    AuActivityKind.OTHER -> "Preparation" to Icons.Outlined.Circle
                }
                val accent = when (kind) {
                    AuActivityKind.SEARCH -> MaterialTheme.colorScheme.primary
                    AuActivityKind.EVIDENCE -> MaterialTheme.colorScheme.tertiary
                    AuActivityKind.ANSWER -> MaterialTheme.colorScheme.primary
                    AuActivityKind.ERROR -> MaterialTheme.colorScheme.error
                    AuActivityKind.OTHER -> MaterialTheme.colorScheme.secondary
                }
                Row(
                    Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.Top,
                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Surface(
                        color = accent.copy(alpha = 0.12f),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Icon(
                            icon,
                            contentDescription = null,
                            tint = accent,
                            modifier = Modifier.padding(8.dp).size(17.dp)
                        )
                    }
                    Column(Modifier.weight(1f)) {
                        Text(label, style = MaterialTheme.typography.labelMedium, color = accent)
                        Text(
                            step,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    val finished = listOf(
                        "linked", "generated", "selected", "combined", "ranked",
                        "searched", "built", "resolved", "listed", "sampled"
                    ).any { step.contains(it, ignoreCase = true) }
                    val failed = kind == AuActivityKind.ERROR
                    Icon(
                        if (failed) Icons.Outlined.ErrorOutline
                        else if (finished) Icons.Outlined.CheckCircle
                        else Icons.Outlined.Circle,
                        contentDescription = if (failed) "Failed"
                            else if (finished) "Completed" else "Recorded",
                        tint = if (failed) MaterialTheme.colorScheme.error
                            else if (finished) Color(0xFF239A75)
                            else MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(17.dp)
                    )
                }
            }
        }
    }
}

@Composable
fun AuWorkingStatus(
    stage: String,
    onStop: () -> Unit,
    modifier: Modifier = Modifier
) {
    Surface(
        modifier = modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
        shape = RoundedCornerShape(8.dp),
        color = Color.Transparent
    ) {
        Row(
            Modifier.padding(start = 15.dp, top = 7.dp, bottom = 7.dp, end = 5.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            CircularProgressIndicator(
                modifier = Modifier.size(17.dp),
                strokeWidth = 2.dp,
                color = MaterialTheme.colorScheme.primary
            )
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    "AU is thinking",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurface
                )
                AuElapsedFeedback(stage)
                if (stage.isNotBlank()) {
                    Text(
                        stage,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
            TextButton(onClick = onStop) { Text("Stop") }
        }
    }
}

/** Elapsed time is a liveness indicator, not a fabricated completion percentage. */
@Composable
fun AuElapsedFeedback(stage: String) {
    var elapsed by remember(stage) { mutableIntStateOf(0) }
    LaunchedEffect(stage) {
        val started = android.os.SystemClock.elapsedRealtime()
        while (true) {
            delay(1000)
            elapsed = ((android.os.SystemClock.elapsedRealtime() - started) / 1000).toInt()
        }
    }
    Text("Current stage · ${elapsed}s", style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable
internal fun AuCompletedActivity(steps: List<String>, durationMs: Long?) {
    if (steps.isEmpty() && durationMs == null) return
    var expanded by remember { androidx.compose.runtime.mutableStateOf(false) }
    val seconds = durationMs?.div(1000)
    val duration = when {
        seconds == null -> "AU activity"
        seconds < 1 -> "AU worked for <1s"
        seconds < 60 -> "AU worked for ${seconds}s"
        else -> "AU worked for ${seconds / 60}m ${seconds % 60}s"
    }
    Column {
        TextButton(onClick = { expanded = !expanded }, enabled = steps.isNotEmpty(),
            contentPadding = PaddingValues(horizontal = 0.dp, vertical = 0.dp)) {
            Text(duration, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (steps.isNotEmpty()) Icon(if (expanded) Icons.Outlined.ExpandMore else Icons.Outlined.ChevronRight,
                contentDescription = if (expanded) "Hide AU activity" else "Show AU activity", modifier = Modifier.size(16.dp))
        }
        androidx.compose.animation.AnimatedVisibility(expanded) { AuActivityTimeline(steps) }
    }
}
