package au.datacube.app.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/** DataCube AU's complete primary palette: navy, light blue, white and black. */
object DataCubeColors {
    val Navy = Color(0xFF0B1F3A)
    val LightBlue = Color(0xFF69B7FF)
    val White = Color(0xFFFFFFFF)
    val Black = Color(0xFF000000)
}

private val LightColors = lightColorScheme(
    primary = DataCubeColors.Navy,
    onPrimary = DataCubeColors.White,
    primaryContainer = DataCubeColors.LightBlue,
    onPrimaryContainer = DataCubeColors.Navy,
    secondary = DataCubeColors.Navy,
    onSecondary = DataCubeColors.White,
    background = DataCubeColors.White,
    onBackground = DataCubeColors.Black,
    surface = DataCubeColors.White,
    onSurface = DataCubeColors.Black,
    surfaceVariant = DataCubeColors.LightBlue,
    onSurfaceVariant = DataCubeColors.Navy,
    outline = DataCubeColors.Navy,
    error = DataCubeColors.Navy,
    onError = DataCubeColors.White
)

private val DarkColors = darkColorScheme(
    primary = DataCubeColors.LightBlue,
    onPrimary = DataCubeColors.Navy,
    primaryContainer = DataCubeColors.Navy,
    onPrimaryContainer = DataCubeColors.LightBlue,
    secondary = DataCubeColors.LightBlue,
    onSecondary = DataCubeColors.Navy,
    background = DataCubeColors.Navy,
    onBackground = DataCubeColors.White,
    surface = DataCubeColors.Navy,
    onSurface = DataCubeColors.White,
    surfaceVariant = DataCubeColors.Navy,
    onSurfaceVariant = DataCubeColors.LightBlue,
    outline = DataCubeColors.LightBlue,
    error = DataCubeColors.LightBlue,
    onError = DataCubeColors.Navy
)

@Composable
fun DataCubeTheme(
    darkTheme: Boolean = false,
    content: @Composable () -> Unit
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        content = content
    )
}
