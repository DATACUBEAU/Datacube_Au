package au.datacube.app.ui.theme

import androidx.compose.foundation.background
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

object DataCubeColors {
    val Blue = Color(0xFF0866F5)
    val BlueDark = Color(0xFF0755CC)
    val BlueLight = Color(0xFFDCEBFF)
    val BluePale = Color(0xFFF2F7FF)
    val Navy = Color(0xFF101B2D)
    val TextSecondary = Color(0xFF58677F)
    val White = Color(0xFFFFFFFF)
    val Black = Color(0xFF080D16)
    val Divider = Color(0xFFE1EAF7)

    val HighlightBlue = Color(0xFFBFD9FF)
}

/**
 * DataCube AU's Compose design tokens. Screens should use these shared values
 * instead of introducing one-off colors, corner radii or type scales.
 */
object DataCubeSpacing {
    val XSmall = 4.dp
    val Small = 8.dp
    val Medium = 12.dp
    val Large = 16.dp
    val XLarge = 20.dp
    val XXLarge = 28.dp
}

private val DataCubeShapes = Shapes(
    extraSmall = RoundedCornerShape(8.dp),
    small = RoundedCornerShape(12.dp),
    medium = RoundedCornerShape(16.dp),
    large = RoundedCornerShape(20.dp),
    extraLarge = RoundedCornerShape(28.dp)
)

private val DataCubeTypography = Typography().copy(
    displayLarge = Typography().displayLarge.copy(fontWeight = FontWeight.Bold),
    displayMedium = Typography().displayMedium.copy(fontWeight = FontWeight.Bold),
    displaySmall = Typography().displaySmall.copy(fontWeight = FontWeight.Bold),
    headlineLarge = Typography().headlineLarge.copy(fontSize = 30.sp, lineHeight = 36.sp, fontWeight = FontWeight.Bold),
    headlineMedium = Typography().headlineMedium.copy(fontSize = 26.sp, lineHeight = 32.sp, fontWeight = FontWeight.Bold),
    headlineSmall = Typography().headlineSmall.copy(fontSize = 22.sp, lineHeight = 28.sp, fontWeight = FontWeight.SemiBold),
    titleLarge = Typography().titleLarge.copy(fontSize = 20.sp, lineHeight = 26.sp, fontWeight = FontWeight.SemiBold),
    titleMedium = Typography().titleMedium.copy(fontSize = 16.sp, lineHeight = 22.sp, fontWeight = FontWeight.SemiBold),
    bodyLarge = Typography().bodyLarge.copy(fontSize = 16.sp, lineHeight = 24.sp),
    bodyMedium = Typography().bodyMedium.copy(fontSize = 14.sp, lineHeight = 21.sp),
    bodySmall = Typography().bodySmall.copy(fontSize = 12.sp, lineHeight = 18.sp),
    labelLarge = Typography().labelLarge.copy(fontSize = 14.sp, fontWeight = FontWeight.SemiBold),
    labelMedium = Typography().labelMedium.copy(fontSize = 12.sp, fontWeight = FontWeight.SemiBold),
    labelSmall = Typography().labelSmall.copy(fontSize = 11.sp, fontWeight = FontWeight.Medium)
)

private val LightColors = lightColorScheme(
    primary = DataCubeColors.Blue,
    onPrimary = DataCubeColors.White,
    primaryContainer = DataCubeColors.BlueLight,
    onPrimaryContainer = DataCubeColors.Navy,
    secondary = DataCubeColors.BlueDark,
    onSecondary = DataCubeColors.White,
    background = DataCubeColors.BluePale,
    onBackground = DataCubeColors.Black,
    surface = DataCubeColors.White,
    onSurface = DataCubeColors.Black,
    surfaceVariant = DataCubeColors.BluePale,
    onSurfaceVariant = DataCubeColors.TextSecondary,
    outline = Color(0xFFB9D2F5),
    outlineVariant = DataCubeColors.Divider,
    error = Color(0xFFB42318),
    onError = DataCubeColors.White
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFF79B5FF),
    onPrimary = DataCubeColors.Navy,
    primaryContainer = DataCubeColors.Navy,
    onPrimaryContainer = DataCubeColors.BlueLight,
    background = Color(0xFF081426),
    onBackground = DataCubeColors.White,
    surface = Color(0xFF10213A),
    onSurface = DataCubeColors.White,
    surfaceVariant = Color(0xFF183052),
    onSurfaceVariant = DataCubeColors.BlueLight,
    outline = Color(0xFF477CB9),
    outlineVariant = Color(0xFF29486D)
)

@Composable
fun DataCubeTheme(darkTheme: Boolean = false, content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        typography = DataCubeTypography,
        shapes = DataCubeShapes,
        content = content
    )
}

/**
 * Shared light-blue visual texture used by the mobile reference screens.
 * The curves are drawn once behind the viewport rather than being composed
 * as image assets or repeated per list item.
 */
fun Modifier.dataCubeBackdrop(): Modifier = this
    .background(
        Brush.linearGradient(
            colorStops = arrayOf(
                0.0f to Color(0xFFFBFDFF),
                0.58f to DataCubeColors.BluePale,
                1.0f to Color(0xFFEAF3FF)
            )
        )
    )
    .drawBehind {
        val width = size.width
        val height = size.height

        drawCircle(
            color = Color(0xFFD7E8FF).copy(alpha = 0.42f),
            radius = width * 0.36f,
            center = Offset(-width * 0.10f, -height * 0.04f)
        )
        drawCircle(
            color = Color(0xFFE5F0FF).copy(alpha = 0.55f),
            radius = width * 0.25f,
            center = Offset(width * 1.02f, height * 0.10f)
        )

        val lowerWave = Path().apply {
            moveTo(0f, height * 0.925f)
            cubicTo(
                width * 0.22f, height * 0.875f,
                width * 0.34f, height * 1.015f,
                width * 0.57f, height * 0.965f
            )
            cubicTo(
                width * 0.77f, height * 0.92f,
                width * 0.86f, height * 0.875f,
                width, height * 0.905f
            )
            lineTo(width, height)
            lineTo(0f, height)
            close()
        }
        drawPath(lowerWave, Color(0xFFB8D8FF).copy(alpha = 0.34f))

        val frontWave = Path().apply {
            moveTo(0f, height * 0.965f)
            cubicTo(
                width * 0.25f, height * 0.925f,
                width * 0.43f, height * 1.025f,
                width * 0.66f, height * 0.985f
            )
            cubicTo(
                width * 0.82f, height * 0.955f,
                width * 0.92f, height * 0.925f,
                width, height * 0.945f
            )
            lineTo(width, height)
            lineTo(0f, height)
            close()
        }
        drawPath(frontWave, Color(0xFF8FC2FF).copy(alpha = 0.16f))
    }
