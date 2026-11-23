package au.datacube.app.ui.documents

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.GraphicEq
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.Stop
import androidx.compose.material.icons.outlined.Headphones
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import au.datacube.app.audio.PodcastSpeaker

/**
 * Original DataCube AU audio stage, inspired by quiet voice interfaces.
 * This is a podcast player, not a live microphone or assistant call.
 */
@Composable
fun AuPodcastStage(
    playing: Boolean,
    activeSpeaker: PodcastSpeaker?,
    status: String,
    hasScript: Boolean,
    enabled: Boolean,
    onPlayPause: () -> Unit
) {
    val pulse by animateFloatAsState(if (playing) 1.08f else 1f, label = "AU audio pulse")
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(28.dp),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.42f),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().heightIn(min = 282.dp)
                .padding(horizontal = 18.dp, vertical = 20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.SpaceBetween
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(
                    Icons.Outlined.GraphicEq,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(32.dp).scale(pulse)
                )
                Spacer(Modifier.height(9.dp))
                Text(
                    if (playing) "AU is speaking" else "Listen with AU",
                    color = MaterialTheme.colorScheme.onSurface,
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.SemiBold
                )
                Text(
                    if (status.isNotBlank()) status
                    else if (hasScript) "Your two-voice audio overview"
                    else "A conversation about your document",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall,
                    textAlign = TextAlign.Center
                )
            }
            FilledIconButton(
                onClick = onPlayPause,
                enabled = enabled && hasScript,
                modifier = Modifier.size(78.dp).scale(pulse),
                shape = CircleShape
            ) {
                Icon(
                    if (playing) Icons.Outlined.Stop else Icons.Outlined.PlayArrow,
                    contentDescription = if (playing) "Stop AU podcast" else "Play AU podcast",
                    modifier = Modifier.size(38.dp)
                )
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceEvenly,
                verticalAlignment = Alignment.CenterVertically
            ) {
                listOf(PodcastSpeaker.HOST to "Host", PodcastSpeaker.GUIDE to "Guide")
                    .forEach { (speaker, label) ->
                        val active = playing && activeSpeaker == speaker
                        Surface(
                            color = if (active) MaterialTheme.colorScheme.primaryContainer
                                else MaterialTheme.colorScheme.surface,
                            shape = RoundedCornerShape(18.dp),
                            border = BorderStroke(1.dp, if (active) MaterialTheme.colorScheme.primary
                                else MaterialTheme.colorScheme.outlineVariant)
                        ) {
                            Row(
                                Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Icon(
                                    Icons.Outlined.Headphones,
                                    contentDescription = null,
                                    modifier = Modifier.size(16.dp),
                                    tint = if (active) MaterialTheme.colorScheme.primary
                                        else MaterialTheme.colorScheme.onSurfaceVariant
                                )
                                Spacer(Modifier.width(6.dp))
                                Text(
                                    label,
                                    color = if (active) MaterialTheme.colorScheme.primary
                                        else MaterialTheme.colorScheme.onSurfaceVariant,
                                    style = MaterialTheme.typography.labelMedium
                                )
                            }
                        }
                    }
            }
        }
    }
}
