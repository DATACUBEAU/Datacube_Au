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
import kotlin.math.cos
import kotlin.math.sin

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
        val sparkle = Color(0xFFB9E5FF)
        onDrawBehind {
            drawRect(background)
            drawCircle(glow, glowRadius, center)
            val rotation = angle?.value ?: .64f
            repeat(22) { i ->
                val depth = (i % 4 + 1) * .24f
                val x = ((i * 73 + 9) % 101) / 101f * size.width + sin(rotation + i) * 7.dp.toPx() * depth
                val y = ((i * 37 + 4) % 97) / 97f * size.height + cos(rotation + i) * 5.dp.toPx() * depth
                drawCircle(sparkle.copy(alpha = .12f + .34f * depth), (.5f + depth).dp.toPx(), Offset(x, y))
            }
            cube.draw(this, center, radius, rotation)
        }
    })
}
