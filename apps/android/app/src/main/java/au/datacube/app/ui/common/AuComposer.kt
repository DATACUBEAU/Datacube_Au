package au.datacube.app.ui.common

import androidx.compose.foundation.BorderStroke
import au.datacube.app.ui.voice.VoiceNoteConfig
import au.datacube.app.ui.voice.VoiceNoteComposer
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowUpward
import androidx.compose.material.icons.outlined.Stop
import androidx.compose.material.icons.outlined.OpenInFull
import androidx.compose.material.icons.outlined.CloseFullscreen
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.Canvas
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.roundToInt
import androidx.compose.material3.*
import androidx.compose.runtime.*
import au.datacube.app.data.rag.AuEffort
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp

/**
 * DataCube AU's native, reusable chat composer. It deliberately does not mimic
 * another product's exact layout, and its actions remain owned by the caller.
 */
@Composable
fun AuComposer(
    value: String,
    onValueChange: (String) -> Unit,
    onSend: () -> Unit,
    placeholder: String,
    enabled: Boolean,
    sendEnabled: Boolean,
    sendDescription: String = "Send to AU",
    modifier: Modifier = Modifier,
    onStop: (() -> Unit)? = null,
    effort: AuEffort = AuEffort.BALANCED,
    onEffortChange: ((AuEffort) -> Unit)? = null,
    leadingActions: @Composable RowScope.() -> Unit = {},
    actions: @Composable RowScope.() -> Unit = {},
    attachmentContent: @Composable ColumnScope.() -> Unit = {},
    voiceNote: VoiceNoteConfig? = null,
    maxMessageChars: Int? = null
) {
    var expanded by rememberSaveable { mutableStateOf(false) }
    var inputWidth by remember { mutableIntStateOf(0) }
    val measurer = rememberTextMeasurer()
    val style = MaterialTheme.typography.bodyLarge
    val canExpand = remember(value, inputWidth, style, measurer) {
        inputWidth > 0 && value.isNotBlank() && measurer.measure(value.take(4000), style = style, maxLines = 4,
            constraints = Constraints(maxWidth = inputWidth)).hasVisualOverflow
    }
    LaunchedEffect(canExpand) { if (!canExpand) expanded = false }
    var tuning by remember { mutableStateOf(false) }
    Surface(
        modifier = modifier.fillMaxWidth()
            .navigationBarsPadding()
            .imePadding()
            .padding(horizontal = 12.dp, vertical = 8.dp),
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(26.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        tonalElevation = 3.dp,
        shadowElevation = 2.dp
    ) {
        val normalContent: @Composable (@Composable () -> Unit) -> Unit = { recordButton ->
        Column(
            modifier = Modifier.padding(start = 15.dp, top = 12.dp, end = 9.dp, bottom = 8.dp),
            verticalArrangement = Arrangement.spacedBy(9.dp)
        ) {
            attachmentContent()
            BasicTextField(
                value = value,
                onValueChange = onValueChange,
                enabled = enabled,
                modifier = Modifier.weight(1f, fill = false).fillMaxWidth().heightIn(min = 24.dp, max = 120.dp).onSizeChanged { inputWidth = it.width }.testTag("au-composer-input"),
                textStyle = MaterialTheme.typography.bodyLarge.copy(
                    color = MaterialTheme.colorScheme.onSurface
                ),
                cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                maxLines = 4,
                decorationBox = { inner ->
                    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterStart) {
                        if (value.isEmpty()) {
                            Text(
                                placeholder,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                style = MaterialTheme.typography.bodyLarge
                            )
                        }
                        inner()
                    }
                }
            )
            if (maxMessageChars != null && value.length > maxMessageChars) {
                Text("Message is too long (${value.length}/$maxMessageChars). Shorten or split it; your draft is unchanged.",
                    color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.labelSmall,
                    modifier = Modifier.testTag("au-message-too-long"))
            }
            Row(
                Modifier.fillMaxWidth().height(48.dp).testTag("au-composer-actions"),
                verticalAlignment = Alignment.CenterVertically
            ) {
                leadingActions()
                Spacer(Modifier.weight(1f))
                if (canExpand) IconButton(onClick = { expanded = true }, enabled = enabled, modifier = Modifier.size(48.dp)) {
                    Icon(Icons.Outlined.OpenInFull, contentDescription = "Expand composer")
                }
                if (onEffortChange != null) {
                    IconButton(onClick = { tuning = true }, enabled = enabled, modifier = Modifier.size(48.dp)) { EffortGauge(effort) }
                }
                actions()
                recordButton()
                Spacer(Modifier.width(4.dp))
                FilledIconButton(
                    onClick = onStop ?: onSend,
                    enabled = onStop != null || (sendEnabled && (maxMessageChars == null || value.length <= maxMessageChars)),
                    modifier = Modifier.size(44.dp),
                    shape = CircleShape
                ) {
                    Icon(
                        if (onStop != null) Icons.Outlined.Stop else Icons.Outlined.ArrowUpward,
                        contentDescription = if (onStop != null) "Stop generating" else sendDescription
                    )
                }
            }
        }
        }
        if (voiceNote == null) normalContent({})
        else key(voiceNote.ownerId, voiceNote.sessionId) { VoiceNoteComposer(voiceNote, normalContent) }
    }
    if (expanded) {
        DataCubeDialog(onDismissRequest = { expanded = false },
            title = {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Edit message", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
                    IconButton(onClick = { expanded = false }) {
                        Icon(Icons.Outlined.CloseFullscreen, "Collapse composer")
                    }
                }
            }, text = {
                BasicTextField(value, onValueChange,
                    modifier = Modifier.fillMaxWidth().heightIn(min = 80.dp, max = 280.dp).testTag("au-expanded-input"),
                    enabled = enabled, textStyle = style.copy(color = MaterialTheme.colorScheme.onSurface),
                    cursorBrush = SolidColor(MaterialTheme.colorScheme.primary))
            }, confirmButton = { TextButton(onClick = { expanded = false }) { Text("Done") } })
    }
    if (tuning && onEffortChange != null) {
        DataCubeDialog(onDismissRequest = { tuning = false },
            title = { Text(effort.label + " effort", style = MaterialTheme.typography.headlineSmall) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { EffortGauge(effort, Modifier.size(56.dp)) }
                    Slider(value = effort.ordinal.toFloat(),
                        onValueChange = { onEffortChange(AuEffort.entries[it.roundToInt().coerceIn(0, AuEffort.entries.lastIndex)]) },
                        valueRange = 0f..AuEffort.entries.lastIndex.toFloat(), steps = AuEffort.entries.size - 2,
                        modifier = Modifier.testTag("au-effort-slider"))
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("Fast", style = MaterialTheme.typography.labelMedium)
                        Text("Maximum", style = MaterialTheme.typography.labelMedium)
                    }
                    Text(effort.description, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }, confirmButton = { TextButton(onClick = { tuning = false }) { Text("Done") } })
    }
}

@Composable
private fun EffortGauge(effort: AuEffort, modifier: Modifier = Modifier.size(28.dp)) {
    val progress by animateFloatAsState(effort.ordinal.toFloat() / AuEffort.entries.lastIndex, label = "effort")
    val accent = MaterialTheme.colorScheme.primary
    val track = MaterialTheme.colorScheme.outlineVariant
    Canvas(modifier.semantics { contentDescription = "Response effort: " + effort.label }) {
        val stroke = size.minDimension * .09f
        val diameter = size.minDimension - stroke * 2
        val top = Offset((size.width - diameter) / 2, (size.height - diameter) / 2)
        val arcSize = androidx.compose.ui.geometry.Size(diameter, diameter)
        drawArc(track, 135f, 270f, false, topLeft = top, size = arcSize, style = Stroke(stroke, cap = StrokeCap.Round))
        drawArc(accent, 135f, 12f + 258f * progress, false, topLeft = top, size = arcSize, style = Stroke(stroke, cap = StrokeCap.Round))
        val angle = Math.toRadians((135 + progress * 270).toDouble())
        val length = diameter * .34f
        drawLine(accent, center, center + Offset((cos(angle) * length).toFloat(), (sin(angle) * length).toFloat()), stroke, StrokeCap.Round)
        drawCircle(accent, stroke * .8f, center)
    }
}
