package au.datacube.app.ui.theme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
object DataCubeColors {
 val Blue=Color(0xFF0866F5); val BlueDark=Color(0xFF0755CC); val BlueLight=Color(0xFFDCEBFF)
 val BluePale=Color(0xFFF2F7FF); val Navy=Color(0xFF101B2D); val TextSecondary=Color(0xFF58677F)
 val White=Color(0xFFFFFFFF); val Black=Color(0xFF080D16); val Divider=Color(0xFFE1EAF7)
}
private val LightColors=lightColorScheme(primary=DataCubeColors.Blue,onPrimary=DataCubeColors.White,primaryContainer=DataCubeColors.BlueLight,onPrimaryContainer=DataCubeColors.Navy,secondary=DataCubeColors.BlueDark,onSecondary=DataCubeColors.White,background=DataCubeColors.BluePale,onBackground=DataCubeColors.Black,surface=DataCubeColors.White,onSurface=DataCubeColors.Black,surfaceVariant=DataCubeColors.BluePale,onSurfaceVariant=DataCubeColors.TextSecondary,outline=Color(0xFFB9D2F5),outlineVariant=DataCubeColors.Divider,error=Color(0xFFB42318),onError=DataCubeColors.White)
private val DarkColors=darkColorScheme(primary=Color(0xFF79B5FF),onPrimary=DataCubeColors.Navy,primaryContainer=DataCubeColors.Navy,onPrimaryContainer=DataCubeColors.BlueLight,background=Color(0xFF081426),onBackground=DataCubeColors.White,surface=Color(0xFF10213A),onSurface=DataCubeColors.White,surfaceVariant=Color(0xFF183052),onSurfaceVariant=DataCubeColors.BlueLight,outline=Color(0xFF477CB9),outlineVariant=Color(0xFF29486D))
@Composable fun DataCubeTheme(darkTheme:Boolean=false,content:@Composable()->Unit){MaterialTheme(colorScheme=if(darkTheme) DarkColors else LightColors,content=content)}
