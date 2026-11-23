package au.datacube.app.ui.common

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Forum
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp

/** High-contrast, compact floating navigation with real destinations. */
@Composable
fun WorkspaceTopBar(
    documentSelected: Boolean,
    onHome: () -> Unit,
    onDocuments: () -> Unit,
    onSettings: () -> Unit,
    modifier: Modifier = Modifier,
    onDiscs: () -> Unit = {},
    discsSelected: Boolean = false
) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(32.dp),
        color = MaterialTheme.colorScheme.surface,
        tonalElevation = 5.dp,
        shadowElevation = 8.dp,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)
    ) {
        Row(
            Modifier.padding(start = 7.dp, end = 5.dp, top = 7.dp, bottom = 7.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(3.dp)
        ) {
            Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                NavPill("AU", Icons.Outlined.AutoAwesome, !documentSelected && !discsSelected,
                    onHome, Modifier.weight(1f))
                NavPill("Gist", Icons.Outlined.Forum, discsSelected,
                    onDiscs, Modifier.weight(1.13f))
                NavPill("Docs", Icons.Outlined.Description, documentSelected,
                    onDocuments, Modifier.weight(1.05f))
            }
            IconButton(onClick = onSettings, modifier = Modifier.size(40.dp)) {
                Icon(Icons.Outlined.Settings, contentDescription = "Settings",
                    tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun NavPill(
    label: String,
    icon: ImageVector,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier
) {
    val background by animateColorAsState(
        if (selected) MaterialTheme.colorScheme.primaryContainer
        else MaterialTheme.colorScheme.surface,
        label = "navigation-background"
    )
    val textColor by animateColorAsState(
        if (selected) MaterialTheme.colorScheme.onPrimaryContainer
        else MaterialTheme.colorScheme.onSurfaceVariant,
        label = "navigation-label"
    )
    val scale by animateFloatAsState(if (selected) 1f else 0.97f, label = "navigation-scale")
    Surface(
        onClick = onClick,
        modifier = modifier.scale(scale),
        shape = RoundedCornerShape(24.dp),
        color = background
    ) {
        Row(Modifier.padding(horizontal = 4.dp, vertical = 11.dp),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, null, Modifier.size(17.dp), tint = textColor)
            Spacer(Modifier.width(4.dp))
            Text(label, style = MaterialTheme.typography.labelMedium,
                color = textColor, maxLines = 1)
        }
    }
}
