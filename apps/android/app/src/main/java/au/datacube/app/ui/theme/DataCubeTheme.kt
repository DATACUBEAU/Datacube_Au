package au.datacube.app.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// ── Brand colours ────────────────────────────────────────────────────────────
private val Blue500 = Color(0xFF2183E3)
private val Blue600 = Color(0xFF1A6DC2)
private val Blue700 = Color(0xFF155BA3)
private val Blue100 = Color(0xFFD6EAFC)

private val Indigo900 = Color(0xFF0F172A)
private val Indigo800 = Color(0xFF1E293B)
private val Indigo700 = Color(0xFF334155)
private val Indigo100 = Color(0xFFE2E8F0)

private val Success = Color(0xFF22C55E)
private val Warning = Color(0xFFF59E0B)
private val Error   = Color(0xFFEF4444)

// ── Light scheme ─────────────────────────────────────────────────────────────
private val LightColors = lightColorScheme(
    primary            = Blue500,
    onPrimary          = Color.White,
    primaryContainer   = Blue100,
    onPrimaryContainer = Blue700,
    secondary          = Indigo700,
    onSecondary        = Color.White,
    background         = Color(0xFFF7F9FC),
    onBackground       = Indigo900,
    surface            = Color.White,
    onSurface          = Indigo900,
    surfaceVariant     = Indigo100,
    onSurfaceVariant   = Indigo700,
    error              = Error,
    onError            = Color.White,
)

// ── Dark scheme ──────────────────────────────────────────────────────────────
private val DarkColors = darkColorScheme(
    primary            = Blue500,
    onPrimary          = Color.White,
    primaryContainer   = Blue700,
    onPrimaryContainer = Blue100,
    secondary          = Indigo100,
    onSecondary        = Indigo900,
    background         = Indigo900,
    onBackground       = Color(0xFFE2E8F0),
    surface            = Indigo800,
    onSurface          = Color(0xFFE2E8F0),
    surfaceVariant     = Indigo700,
    onSurfaceVariant   = Indigo100,
    error              = Error,
    onError            = Color.White,
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
