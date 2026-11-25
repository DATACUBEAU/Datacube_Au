package au.datacube.app.ui.common

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

/** Fixed conceptual illustration. Geometry is not a numerical simulation. */
@Composable
internal fun AuProjectileIllustration() {
    val ink = MaterialTheme.colorScheme.onSurface
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    val accent = MaterialTheme.colorScheme.primary
    Column(Modifier.fillMaxWidth(),verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text("Projectile motion",style = MaterialTheme.typography.titleMedium)
        Canvas(Modifier.fillMaxWidth().height(172.dp).semantics {
            contentDescription = "A person tosses a ball upward. The ball follows a curved path, reaches a high point, and returns to the ground."
        }) {
            fun p(x:Float,y:Float)=Offset(size.width*x,size.height*y)
            val stroke = 2.dp.toPx()
            drawLine(muted,p(.04f,.86f),p(.96f,.86f),stroke)
            val hip = p(.13f,.64f)
            val neck = p(.13f,.43f)
            drawCircle(ink,10.dp.toPx(),p(.13f,.33f),style=Stroke(stroke))
            drawLine(ink,neck,hip,stroke)
            drawLine(ink,hip,p(.08f,.86f),stroke)
            drawLine(ink,hip,p(.19f,.86f),stroke)
            drawLine(ink,p(.13f,.47f),p(.22f,.49f),stroke)
            drawLine(ink,p(.13f,.48f),p(.07f,.58f),stroke)
            val trajectory = Path().apply {
                moveTo(p(.25f,.48f).x,p(.25f,.48f).y)
                quadraticBezierTo(p(.56f,-.30f).x,p(.56f,-.30f).y,p(.89f,.86f).x,p(.89f,.86f).y)
            }
            drawPath(trajectory,accent,style=Stroke(2.5.dp.toPx(),pathEffect=PathEffect.dashPathEffect(floatArrayOf(8.dp.toPx(),5.dp.toPx()))))
            drawCircle(accent,6.dp.toPx(),p(.25f,.48f))
            drawCircle(accent,5.dp.toPx(),p(.51f,.17f))
            drawCircle(accent,6.dp.toPx(),p(.89f,.84f))
            drawLine(muted,p(.70f,.25f),p(.70f,.51f),stroke)
            drawLine(muted,p(.70f,.51f),p(.675f,.46f),stroke)
            drawLine(muted,p(.70f,.51f),p(.725f,.46f),stroke)
        }
        Text("The ball rises, slows vertically, then falls. Gravity acts downward throughout.",style=MaterialTheme.typography.bodySmall)
        Text("Conceptual illustration · Not to scale · Air resistance ignored",style=MaterialTheme.typography.labelSmall,color=muted)
    }
}
