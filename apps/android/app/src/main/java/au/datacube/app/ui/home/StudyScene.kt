package au.datacube.app.ui.home

import androidx.compose.foundation.layout.Spacer
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.MotionDurationScale
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.flow.collectLatest
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

// The web productivity scene uses two blue glows and particles at different depths.
// Project the cube and the particle layers into a single, clipped drawing surface.
@Composable
internal fun StudyScene(modifier: Modifier) {
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var angle by remember { mutableFloatStateOf(0.64f) }
    LaunchedEffect(lifecycle) {
        val motion = coroutineContext[MotionDurationScale]
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            snapshotFlow { motion?.scaleFactor ?: 1f }.collectLatest { scale ->
                if (scale <= 0f) {
                    angle = 0.64f
                    return@collectLatest
                }
                var previous = withFrameNanos { it }
                while (true) {
                    withFrameNanos { now ->
                        val elapsed = now - previous
                        if (elapsed >= 32_000_000L) {
                            angle = (angle + elapsed.coerceAtMost(100_000_000L) / 1e9f * .13f / scale) % (2f * PI.toFloat())
                            previous = now
                        }
                    }
                }
            }
        }
    }
    Spacer(modifier.drawWithCache {
        val background = Brush.linearGradient(listOf(Color(0xFF081322), Color(0xFF102F55), Color(0xFF0755A3)))
        val center = Offset(size.width * .83f, size.height * .39f)
        val glowRadius = size.width * .52f
        val glow = Brush.radialGradient(listOf(Color(0xAD197AE5), Color.Transparent), center, glowRadius)
        val radius = minOf(size.width * .115f, size.height * .20f)
        val outline = Color(0xFFADDFFF)
        val face = Path()
        val vertices = Array(8) { Offset.Zero }
        val faces = arrayOf(intArrayOf(0, 1, 3, 2), intArrayOf(4, 5, 7, 6))
        val sparkle = Color(0xFFB9E5FF)
        onDrawBehind {
            drawRect(background)
            drawCircle(glow, glowRadius, center)
            val rotation = angle
            repeat(22) { i ->
                val depth = (i % 4 + 1) * .24f
                val x = ((i * 73 + 9) % 101) / 101f * size.width + sin(rotation + i) * 7.dp.toPx() * depth
                val y = ((i * 37 + 4) % 97) / 97f * size.height + cos(rotation + i) * 5.dp.toPx() * depth
                drawCircle(sparkle.copy(alpha = .12f + .34f * depth), (.5f + depth).dp.toPx(), Offset(x, y))
            }
            val c = cos(rotation)
            val s = sin(rotation)
            for (i in vertices.indices) {
                val x = if (i and 1 == 0) -1f else 1f
                val y = if (i and 2 == 0) -1f else 1f
                val z = if (i and 4 == 0) -1f else 1f
                val rotatedZ = z * c - x * s
                val perspective = 4.8f / (4.8f - (.89f * rotatedZ + .45f * y))
                vertices[i] = center + Offset(x * c + z * s, y * .89f - rotatedZ * .45f) * (radius * perspective)
            }
            for (indices in faces) {
                face.reset()
                indices.forEachIndexed { index, corner ->
                    val point = vertices[corner]
                    if (index == 0) face.moveTo(point.x, point.y) else face.lineTo(point.x, point.y)
                }
                face.close()
                drawPath(face, Color(0x227CC4FF))
            }
            for (i in vertices.indices) {
                for (bit in CubeAxes) {
                    if (i and bit == 0) drawLine(outline.copy(alpha = .74f), vertices[i], vertices[i or bit], 1.dp.toPx())
                }
                drawCircle(outline, 1.8.dp.toPx(), vertices[i])
            }
        }
    })
}

private val CubeAxes = intArrayOf(1, 2, 4)
