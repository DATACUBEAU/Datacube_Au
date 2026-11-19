package au.datacube.app.ui.auth

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import au.datacube.app.R

private val AuthNavy = Color(0xFF071426)
private val AuthBlue = Color(0xFF318BFF)
private val AuthCyan = Color(0xFF78D5FF)
private val AuthMuted = Color(0xFFB8C9DE)

/** Native, minimal entry screen. The website remains the source of truth for authentication. */
@Composable
fun AuthScreen(
    viewModel: AuthViewModel,
    onOpenWebsite: (String) -> Unit
) {
    val state by viewModel.state.collectAsState()
    val colors = MaterialTheme.colorScheme

    val motion = rememberInfiniteTransition(label = "auth-background-motion")
    val drift by motion.animateFloat(
        initialValue = -0.10f,
        targetValue = 0.10f,
        animationSpec = infiniteRepeatable(
            animation = tween(9000, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "background-drift"
    )
    val orbit by motion.animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(
            animation = tween(26000, easing = androidx.compose.animation.core.LinearEasing)
        ),
        label = "logo-orbit"
    )
    val breathe by motion.animateFloat(
        initialValue = 0.88f,
        targetValue = 1.08f,
        animationSpec = infiniteRepeatable(
            animation = tween(3200, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "logo-glow"
    )

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(
                    listOf(Color(0xFF06101F), Color(0xFF0A1B32), Color(0xFF071426))
                )
            )
    ) {
        Canvas(Modifier.fillMaxSize()) {
            val w = size.width
            val h = size.height
            val center = Offset(w * (0.5f + drift), h * 0.30f)

            drawCircle(
                brush = Brush.radialGradient(
                    colors = listOf(Color(0x55318BFF), Color(0x22318BFF), Color.Transparent),
                    center = center,
                    radius = w * 0.72f
                ),
                radius = w * 0.72f,
                center = center
            )
            drawCircle(
                brush = Brush.radialGradient(
                    colors = listOf(Color(0x2278D5FF), Color.Transparent),
                    center = Offset(w * 0.92f, h * 0.70f),
                    radius = w * 0.50f
                ),
                radius = w * 0.50f,
                center = Offset(w * 0.92f, h * 0.70f)
            )

            // Perspective floor grid: restrained lines create depth without a heavy 3D asset.
            val horizon = h * 0.58f
            for (index in 0..12) {
                val x = w * index / 12f
                drawLine(
                    color = AuthBlue.copy(alpha = 0.10f),
                    start = Offset(w * 0.5f, horizon),
                    end = Offset(x, h * 1.08f),
                    strokeWidth = 1.dp.toPx()
                )
            }
            for (index in 0..9) {
                val progress = index / 9f
                val y = horizon + (h * 0.48f * progress * progress)
                drawLine(
                    color = AuthBlue.copy(alpha = 0.07f + progress * 0.035f),
                    start = Offset(0f, y),
                    end = Offset(w, y),
                    strokeWidth = 1.dp.toPx()
                )
            }
        }

        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 28.dp, vertical = 36.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Box(
                modifier = Modifier.size(154.dp),
                contentAlignment = Alignment.Center
            ) {
                Box(
                    modifier = Modifier
                        .size(142.dp)
                        .graphicsLayer {
                            rotationZ = orbit
                            scaleX = breathe
                            scaleY = breathe
                        }
                        .drawBehind {
                            drawCircle(
                                brush = Brush.radialGradient(
                                    listOf(
                                        Color(0x66318BFF),
                                        Color(0x22318BFF),
                                        Color.Transparent
                                    )
                                ),
                                radius = size.minDimension * 0.50f
                            )
                            drawCircle(
                                color = AuthCyan.copy(alpha = 0.55f),
                                radius = size.minDimension * 0.46f,
                                style = Stroke(width = 1.2.dp.toPx())
                            )
                            drawCircle(
                                color = AuthBlue.copy(alpha = 0.30f),
                                radius = size.minDimension * 0.36f,
                                style = Stroke(
                                    width = 1.dp.toPx(),
                                    pathEffect = androidx.compose.ui.graphics.PathEffect.dashPathEffect(
                                        floatArrayOf(5.dp.toPx(), 8.dp.toPx())
                                    )
                                )
                            )
                        }
                )
                Image(
                    painter = painterResource(R.drawable.datacube_app_icon),
                    contentDescription = "DataCube AU",
                    modifier = Modifier
                        .size(88.dp)
                        .clip(RoundedCornerShape(24.dp))
                        .drawBehind {
                            drawCircle(
                                color = AuthBlue.copy(alpha = 0.22f),
                                radius = size.minDimension * 0.72f
                            )
                        }
                )
            }

            Spacer(Modifier.height(18.dp))
            Text(
                text = "DATACUBE AU",
                style = MaterialTheme.typography.labelLarge,
                color = AuthCyan,
                fontWeight = FontWeight.Bold,
                letterSpacing = androidx.compose.ui.unit.TextUnit(3f, androidx.compose.ui.unit.TextUnitType.Sp)
            )
            Spacer(Modifier.height(12.dp))
            Text(
                text = "Welcome back.",
                style = MaterialTheme.typography.headlineLarge,
                color = Color.White,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center
            )
            Spacer(Modifier.height(8.dp))
            Text(
                text = "Your knowledge. One connected space.",
                style = MaterialTheme.typography.bodyLarge,
                color = AuthMuted,
                textAlign = TextAlign.Center
            )

            Spacer(Modifier.height(38.dp))
            Button(
                onClick = { viewModel.createWebsiteLoginUrl("login")?.let(onOpenWebsite) },
                enabled = !state.isLoading,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp),
                shape = RoundedCornerShape(18.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = Color(0xFF247CEB),
                    contentColor = Color.White,
                    disabledContainerColor = Color(0xFF247CEB).copy(alpha = 0.45f)
                )
            ) {
                if (state.isLoading) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(19.dp),
                        color = Color.White,
                        strokeWidth = 2.dp
                    )
                    Spacer(Modifier.size(10.dp))
                }
                Text("Continue with Google", fontWeight = FontWeight.SemiBold)
            }

            Spacer(Modifier.height(12.dp))
            OutlinedButton(
                onClick = { viewModel.createWebsiteLoginUrl("signup")?.let(onOpenWebsite) },
                enabled = !state.isLoading,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(54.dp),
                shape = RoundedCornerShape(18.dp),
                border = BorderStroke(1.dp, Color(0x668CBFFF)),
                colors = ButtonDefaults.outlinedButtonColors(
                    contentColor = Color(0xFFEAF4FF),
                    containerColor = Color.Transparent
                )
            ) {
                Text("Create account", fontWeight = FontWeight.Medium)
            }

            state.error?.let { message ->
                Spacer(Modifier.height(18.dp))
                Text(
                    text = message,
                    style = MaterialTheme.typography.bodySmall,
                    color = Color(0xFFFFB8B8),
                    textAlign = TextAlign.Center,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(Color(0x22FF7777))
                        .padding(horizontal = 14.dp, vertical = 10.dp)
                )
            }
            Spacer(Modifier.height(24.dp))
            Text(
                text = "Secure sign-in",
                style = MaterialTheme.typography.labelSmall,
                color = AuthMuted.copy(alpha = 0.65f)
            )
        }
    }
}
