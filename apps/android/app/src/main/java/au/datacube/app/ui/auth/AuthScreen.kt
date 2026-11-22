package au.datacube.app.ui.auth

import android.database.ContentObserver
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.credentials.Credential
import androidx.credentials.GetCredentialRequest
import au.datacube.app.R
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

private val AuthMuted = Color(0xFFB8C9DE)
private val AuthBlue = Color(0xFF318BFF)

// The logo is the shipped DataCube AU artwork. All animation is around it,
// never a replacement or recoloring of the approved icon.
@Composable
fun AuthScreen(
    viewModel: AuthViewModel,
    getGoogleCredential: suspend (GetCredentialRequest) -> Credential
) {
    val state by viewModel.state.collectAsState()
    val motionEnabled = rememberAuthMotionEnabled()
    val motionPhase = if (motionEnabled) {
        val transition = rememberInfiniteTransition(label = "DataCube AU ambient motion")
        val animated by transition.animateFloat(
            initialValue = 0f,
            targetValue = (2 * PI).toFloat(),
            animationSpec = infiniteRepeatable(tween(22000, easing = LinearEasing)),
            label = "Ambient drift"
        )
        animated
    } else 0f

    val buttonInteraction = remember { MutableInteractionSource() }
    val pressed by buttonInteraction.collectIsPressedAsState()
    val buttonScale by animateFloatAsState(
        targetValue = if (motionEnabled && pressed) .97f else 1f,
        animationSpec = tween(130),
        label = "Google button press"
    )

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Brush.verticalGradient(listOf(Color(0xFF06101F), Color(0xFF0A1B32), Color(0xFF071426))))
    ) {
        Canvas(modifier = Modifier.fillMaxSize()) {
            val center = Offset(size.width * .78f, size.height * .26f)
            val glowRadius = size.width * .9f
            drawCircle(
                brush = Brush.radialGradient(
                    colors = listOf(Color(0x253B9DFF), Color.Transparent),
                    center = center,
                    radius = glowRadius
                ),
                radius = glowRadius,
                center = center
            )
            // Depth-staggered drifting points provide a light-weight native
            // perspective effect without an expensive 3D rendering engine.
            repeat(24) { index ->
                val depth = (index % 4 + 1) / 4f
                val xBase = ((index * 43 + 19) % 101) / 101f
                val yBase = ((index * 67 + 13) % 103) / 103f
                val x = xBase * size.width + sin(motionPhase + index * .71f) * 12.dp.toPx() * depth
                val y = yBase * size.height + cos(motionPhase + index * .83f) * 18.dp.toPx() * depth
                drawCircle(
                    color = Color(0xFF83CAFF).copy(alpha = .08f + .22f * depth),
                    radius = (.5f + depth * 1.25f).dp.toPx(),
                    center = Offset(x, y)
                )
            }
        }

        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 28.dp, vertical = 24.dp)
                .verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Box(modifier = Modifier.size(150.dp), contentAlignment = Alignment.Center) {
                Canvas(modifier = Modifier.fillMaxSize()) {
                    val center = Offset(size.width / 2f, size.height / 2f)
                    val radius = size.minDimension * .465f
                    val pulse = (sin(motionPhase).toFloat() + 1f) * .5f
                    drawCircle(
                        color = AuthBlue.copy(alpha = .15f + pulse * .14f),
                        radius = radius,
                        center = center,
                        style = Stroke(width = 9.dp.toPx())
                    )
                    drawCircle(
                        color = Color(0xFF5DBFFF).copy(alpha = .65f + pulse * .2f),
                        radius = radius,
                        center = center,
                        style = Stroke(width = 1.5.dp.toPx())
                    )
                    drawArc(
                        color = Color(0xFF92E0FF),
                        startAngle = motionPhase * 180f / PI.toFloat(),
                        sweepAngle = 80f,
                        useCenter = false,
                        style = Stroke(width = 2.5.dp.toPx())
                    )
                }
                Image(
                    painter = painterResource(R.drawable.datacube_logo),
                    contentDescription = "DataCube AU",
                    modifier = Modifier.size(94.dp).clip(RoundedCornerShape(22.dp))
                )
            }
            Spacer(Modifier.height(14.dp))
            Text(
                "DATACUBE AU",
                color = Color(0xFF78D5FF),
                fontWeight = FontWeight.Bold,
                letterSpacing = 3.sp,
                style = MaterialTheme.typography.labelLarge
            )
            Spacer(Modifier.height(19.dp))
            Text(
                "Welcome back.",
                color = Color.White,
                fontWeight = FontWeight.Bold,
                style = MaterialTheme.typography.headlineLarge,
                textAlign = TextAlign.Center
            )
            Spacer(Modifier.height(38.dp))
            Button(
                onClick = { viewModel.signInWithGoogle(getGoogleCredential) },
                enabled = !state.isLoading,
                interactionSource = buttonInteraction,
                modifier = Modifier.fillMaxWidth().height(56.dp).scale(buttonScale),
                shape = RoundedCornerShape(18.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = Color(0xFF247CEB),
                    contentColor = Color.White
                )
            ) {
                if (state.isLoading) {
                    CircularProgressIndicator(Modifier.size(19.dp), color = Color.White, strokeWidth = 2.dp)
                    Spacer(Modifier.size(10.dp))
                }
                Text("Continue with Google", fontWeight = FontWeight.SemiBold)
            }
            state.error?.let { message ->
                Spacer(Modifier.height(18.dp))
                Text(
                    message,
                    color = Color(0xFFFFB8B8),
                    style = MaterialTheme.typography.bodySmall,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite }
                )
            }
        }
    }
}

@Composable
private fun rememberAuthMotionEnabled(): Boolean {
    val resolver = LocalContext.current.contentResolver
    fun allowed() = Settings.Global.getFloat(
        resolver,
        Settings.Global.ANIMATOR_DURATION_SCALE,
        1f
    ) > 0f
    var enabled by remember(resolver) { mutableStateOf(allowed()) }
    DisposableEffect(resolver) {
        val observer = object : ContentObserver(Handler(Looper.getMainLooper())) {
            override fun onChange(selfChange: Boolean) {
                enabled = allowed()
            }
        }
        resolver.registerContentObserver(
            Settings.Global.getUriFor(Settings.Global.ANIMATOR_DURATION_SCALE),
            false,
            observer
        )
        enabled = allowed()
        onDispose { resolver.unregisterContentObserver(observer) }
    }
    return enabled
}
