package au.datacube.app.ui.common

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowUpward
import androidx.compose.material.icons.outlined.Stop
import androidx.compose.material.icons.outlined.OpenInFull
import androidx.compose.material.icons.outlined.CloseFullscreen
import androidx.compose.material.icons.outlined.Tune
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
    actions: @Composable RowScope.() -> Unit = {}
) {
    var expanded by remember { mutableStateOf(false) }
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
        Column(
            modifier = Modifier.padding(start = 15.dp, top = 12.dp, end = 9.dp, bottom = 8.dp),
            verticalArrangement = Arrangement.spacedBy(9.dp)
        ) {
            BasicTextField(
                value = value,
                onValueChange = onValueChange,
                enabled = enabled,
                modifier = Modifier.fillMaxWidth().heightIn(min = 31.dp).testTag("au-composer-input"),
                textStyle = MaterialTheme.typography.bodyLarge.copy(
                    color = MaterialTheme.colorScheme.onSurface
                ),
                cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                maxLines = if (expanded) 14 else 5,
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
            Row(
                Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically
            ) {
                actions()
                Spacer(Modifier.weight(1f))
                IconButton(onClick = { expanded = !expanded }) {
                    Icon(if (expanded) Icons.Outlined.CloseFullscreen else Icons.Outlined.OpenInFull,
                        contentDescription = if (expanded) "Collapse composer" else "Expand composer")
                }
                if (onEffortChange != null) {
                    Box {
                        IconButton(onClick = { tuning = true }, enabled = enabled) {
                            Icon(Icons.Outlined.Tune, contentDescription = "Response effort: " + effort.label,
                                tint = MaterialTheme.colorScheme.primary)
                        }
                        DropdownMenu(expanded = tuning, onDismissRequest = { tuning = false }) {
                            AuEffort.entries.forEach { mode ->
                                DropdownMenuItem(
                                    text = {
                                        Column {
                                            Text(mode.label)
                                            Text(mode.description, style = MaterialTheme.typography.labelSmall)
                                        }
                                    },
                                    onClick = { onEffortChange(mode); tuning = false },
                                    trailingIcon = { if (effort == mode) Text("✓") }
                                )
                            }
                        }
                    }
                }
                Spacer(Modifier.width(4.dp))
                FilledIconButton(
                    onClick = onStop ?: onSend,
                    enabled = onStop != null || sendEnabled,
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
}
