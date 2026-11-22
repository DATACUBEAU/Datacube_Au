package au.datacube.app.ui

import android.database.ContentObserver
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlin.math.cos
import kotlin.math.sin

@Composable
internal fun rememberAmbientMotionEnabled(): Boolean {
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val stage by lifecycle.currentStateFlow.collectAsState()
    val resolver = LocalContext.current.contentResolver
    val setting = Settings.Global.ANIMATOR_DURATION_SCALE
    fun motionAllowed() = Settings.Global.getFloat(resolver, setting, 1f) > 0f

    var enabled by remember(resolver) { mutableStateOf(motionAllowed()) }
    DisposableEffect(resolver) {
        val observer = object : ContentObserver(Handler(Looper.getMainLooper())) {
            override fun onChange(selfChange: Boolean) {
                enabled = motionAllowed()
            }
        }
        resolver.registerContentObserver(Settings.Global.getUriFor(setting), false, observer)
        enabled = motionAllowed()
        onDispose { resolver.unregisterContentObserver(observer) }
    }
    return enabled && stage.isAtLeast(Lifecycle.State.RESUMED)
}

internal class WireframeCube {
    private val face = Path()
    private val vertices = Array(8) { Offset.Zero }
    private val faces = arrayOf(intArrayOf(0, 1, 3, 2), intArrayOf(4, 5, 7, 6))
    private val axes = intArrayOf(1, 2, 4)

    fun draw(scope: DrawScope, center: Offset, radius: Float, rotation: Float, opacity: Float = 1f) = with(scope) {
        val cosine = cos(rotation)
        val sine = sin(rotation)
        for (index in vertices.indices) {
            val x = if (index and 1 == 0) -1f else 1f
            val y = if (index and 2 == 0) -1f else 1f
            val z = if (index and 4 == 0) -1f else 1f
            val rotatedZ = z * cosine - x * sine
            val perspective = 4.8f / (4.8f - (.89f * rotatedZ + .45f * y))
            val projected = Offset(x * cosine + z * sine, y * .89f - rotatedZ * .45f)
            vertices[index] = center + projected * (radius * perspective)
        }
        val fill = Color(0xFF7CC4FF).copy(alpha = .133f * opacity)
        for (indices in faces) {
            face.reset()
            val first = vertices[indices.first()]
            face.moveTo(first.x, first.y)
            for (index in 1 until indices.size) {
                val point = vertices[indices[index]]
                face.lineTo(point.x, point.y)
            }
            face.close()
            drawPath(face, fill)
        }
        val outline = Color(0xFFADDFFF)
        val edge = outline.copy(alpha = .74f * opacity)
        val corner = outline.copy(alpha = opacity)
        for (index in vertices.indices) {
            for (axis in axes) {
                if (index and axis == 0) {
                    drawLine(edge, vertices[index], vertices[index or axis], 1.dp.toPx())
                }
            }
            drawCircle(corner, 1.8.dp.toPx(), vertices[index])
        }
    }
}
