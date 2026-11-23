package au.datacube.app.ui.home

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Spacer
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import au.datacube.app.ui.WireframeCube
import au.datacube.app.ui.rememberAmbientMotionEnabled
import kotlin.math.PI

// The web productivity scene uses two blue glows and particles at different depths.
// Project the cube and the particle layers into a single, clipped drawing surface.
@Composable
internal fun StudyScene(modifier: Modifier) {
    val angle = if (rememberAmbientMotionEnabled()) {
        rememberInfiniteTransition(label = "Study scene").animateFloat(
            initialValue = .64f, targetValue = .64f + 2f * PI.toFloat(),
            animationSpec = infiniteRepeatable(tween(48_000, easing = LinearEasing)),
            label = "Cube rotation"
        )
    } else null
    Spacer(modifier.drawWithCache {
        val background = Brush.linearGradient(listOf(Color(0xFF081322), Color(0xFF102F55), Color(0xFF0755A3)))
        val center = Offset(size.width * .83f, size.height * .39f)
        val glowRadius = size.width * .52f
        val glow = Brush.radialGradient(listOf(Color(0xAD197AE5), Color.Transparent), center, glowRadius)
        val radius = minOf(size.width * .115f, size.height * .20f)
        val cube = WireframeCube()
        onDrawBehind {
            drawRect(background)
            drawCircle(glow, glowRadius, center)
            val rotation = angle?.value ?: .64f
            cube.draw(this, center, radius, rotation)
        }
    })
}
