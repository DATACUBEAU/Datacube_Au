package au.datacube.app.ui.auth

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
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
import au.datacube.app.ui.WireframeCube
import au.datacube.app.ui.rememberAmbientMotionEnabled
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

private val AuthBlue = Color(0xFF318BFF)

@Composable
fun AuthScreen(
    viewModel: AuthViewModel,
    getGoogleCredential: suspend (GetCredentialRequest) -> Credential
) {
    val state by viewModel.state.collectAsState()
    val motionEnabled = rememberAmbientMotionEnabled()
    val motionPhase = if (motionEnabled) {
        val transition = rememberInfiniteTransition(label = "DataCube AU ambient motion")
        transition.animateFloat(
            initialValue = 0f,
            targetValue = (2 * PI).toFloat(),
            animationSpec = infiniteRepeatable(tween(22_000, easing = LinearEasing)),
            label = "Ambient drift"
        )
    } else null

    val buttonInteraction = remember { MutableInteractionSource() }
    val pressed by buttonInteraction.collectIsPressedAsState()
    val buttonScale = animateFloatAsState(
        targetValue = if (motionEnabled && pressed) .97f else 1f,
        animationSpec = tween(130),
        label = "Google button press"
    )

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Brush.verticalGradient(listOf(Color(0xFF06101F), Color(0xFF0A1B32), Color(0xFF071426))))
    ) {
        AuthBackdrop(motionPhase)

        Column(
            modifier = Modifier
                .align(Alignment.Center)
                .widthIn(max = 480.dp)
                .fillMaxWidth()
                .fillMaxHeight()
                .padding(horizontal = 28.dp, vertical = 24.dp)
                .verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            AuthLogo(motionPhase)
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
                modifier = Modifier.fillMaxWidth().height(56.dp).graphicsLayer {
                    val scale = buttonScale.value
                    scaleX = scale
                    scaleY = scale
                },
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
internal fun AuthBackdrop(motionPhase: State<Float>?) {
    Spacer(Modifier.fillMaxSize().drawWithCache {
        val center = Offset(size.width * .80f, size.height * .23f)
        val glowRadius = size.width * .9f
        val glow = Brush.radialGradient(listOf(Color(0x333B9DFF), Color.Transparent), center, glowRadius)
        val cube = WireframeCube()
        val cubeRadius = minOf(size.width * .17f, size.height * .14f)
        val driftX = 12.dp.toPx()
        val driftY = 18.dp.toPx()
        onDrawBehind {
            val phase = motionPhase?.value ?: 0f
            drawCircle(glow, glowRadius, center)
            cube.draw(this, center, cubeRadius, phase - .64f, opacity = .37f)
            repeat(24) { index ->
                val depth = (index % 4 + 1) / 4f
                val xBase = ((index * 43 + 19) % 101) / 101f
                val yBase = ((index * 67 + 13) % 103) / 103f
                val x = xBase * size.width + sin(phase + index * .71f) * driftX * depth
                val y = yBase * size.height + cos(phase + index * .83f) * driftY * depth
                drawCircle(
                    color = Color(0xFF83CAFF).copy(alpha = .08f + .22f * depth),
                    radius = (.5f + depth * 1.25f).dp.toPx(),
                    center = Offset(x, y)
                )
            }
        }
    })
}

@Composable
internal fun AuthLogo(motionPhase: State<Float>?) {
    Box(modifier = Modifier.size(150.dp), contentAlignment = Alignment.Center) {
        Spacer(Modifier.matchParentSize().drawWithCache {
            val center = Offset(size.width / 2f, size.height / 2f)
            val radius = size.minDimension * .465f
            val ringTopLeft = center - Offset(radius, radius)
            val ringSize = Size(radius * 2f, radius * 2f)
            val lightRadius = size.minDimension * .58f
            val light = Brush.radialGradient(
                0f to Color(0xFF508DFF),
                .52f to Color(0xAA318BFF),
                1f to Color.Transparent,
                center = center,
                radius = lightRadius
            )
            val outerStroke = Stroke(width = 9.dp.toPx())
            val ringStroke = Stroke(width = 1.5.dp.toPx())
            val arcStroke = Stroke(width = 2.5.dp.toPx(), cap = StrokeCap.Round)
            onDrawBehind {
                val phase = motionPhase?.value ?: 0f
                val pulse = (sin(phase) + 1f) * .5f
                drawCircle(light, lightRadius, center, alpha = .28f + pulse * .24f)
                drawCircle(AuthBlue.copy(alpha = .15f + pulse * .14f), radius, center, style = outerStroke)
                drawCircle(Color(0xFF5DBFFF).copy(alpha = .65f + pulse * .2f), radius, center, style = ringStroke)
                drawArc(
                    color = Color(0xFF92E0FF),
                    startAngle = phase * 180f / PI.toFloat(),
                    sweepAngle = 80f,
                    useCenter = false,
                    topLeft = ringTopLeft,
                    size = ringSize,
                    style = arcStroke
                )
            }
        })
        Image(
            painter = painterResource(R.drawable.datacube_logo),
            contentDescription = "DataCube AU",
            modifier = Modifier.size(94.dp).clip(RoundedCornerShape(22.dp))
        )
    }
}
