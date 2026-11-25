package au.datacube.app.ui.common

import android.graphics.Paint
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import kotlin.math.hypot

/** Bounded declarative drawing instructions; no executable code, URLs or external media. */
internal data class AuSketchCommand(val kind: String,val coordinates: List<Int>,val label: String = "")
internal data class AuSketchScene(val title: String,val description: String,val commands: List<AuSketchCommand>)

internal object AuSketchParser {
    private val arities = mapOf("LINE" to 4,"ARROW" to 4,"CIRCLE" to 3,"RECT" to 4,
        "ELLIPSE" to 4,"CURVE" to 6,"LABEL" to 2)
    private fun validText(s:String,max:Int) = s.length in 1..max && s.none { it.isISOControl() } &&
        !s.contains('[') && !s.contains(']') && !s.contains('<') && !s.contains('>')
    fun parse(title:String,lines:List<String>): AuSketchScene? {
        if (!validText(title,100) || lines.size !in 2..21) return null
        val alt = lines.first().split('|',limit=2).map(String::trim)
        if (alt.size != 2 || alt[0] != "ALT" || !validText(alt[1],400)) return null
        val commands = lines.drop(1).map { raw ->
            val parts = raw.split('|').map(String::trim)
            val kind = parts.firstOrNull() ?: return null
            val count = arities[kind] ?: return null
            if (parts.size != count + 1 + if (kind=="LABEL") 1 else 0) return null
            val coordinates = parts.drop(1).take(count).map { it.toIntOrNull()?.takeIf { n -> n in 0..100 } ?: return null }
            val label = if (kind=="LABEL") parts.last() else ""
            if (kind=="LABEL" && !validText(label,48)) return null
            if (kind=="CIRCLE" && coordinates[2] !in 1..45) return null
            if (kind in setOf("RECT","ELLIPSE") && (coordinates[0]>=coordinates[2] || coordinates[1]>=coordinates[3])) return null
            AuSketchCommand(kind,coordinates,label)
        }
        if (commands.none { it.kind != "LABEL" }) return null
        return AuSketchScene(title,alt[1],commands)
    }
}

@Composable
internal fun AuSketchIllustration(scene:AuSketchScene) {
    val ink = MaterialTheme.colorScheme.onSurface
    val accent = MaterialTheme.colorScheme.primary
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    Column(Modifier.fillMaxWidth(),verticalArrangement=Arrangement.spacedBy(6.dp)) {
        Text(scene.title,style=MaterialTheme.typography.titleMedium)
        Canvas(Modifier.fillMaxWidth().height(220.dp).semantics { contentDescription=scene.description }) {
            val margin=12.dp.toPx()
            val width=(size.width-2*margin).coerceAtLeast(1f)
            val height=(size.height-2*margin).coerceAtLeast(1f)
            val stroke=2.dp.toPx()
            val labelPaint=Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color=ink.toArgb()
                textSize=12.dp.toPx()
            }
            fun point(x:Int,y:Int)=Offset(margin+width*x/100f,margin+height*y/100f)
            scene.commands.forEach { command ->
                val c=command.coordinates
                val a=point(c[0],c[1])
                when(command.kind) {
                    "LINE","ARROW" -> {
                        val z=point(c[2],c[3])
                        drawLine(ink,a,z,stroke)
                        if(command.kind=="ARROW") {
                            val dx=z.x-a.x; val dy=z.y-a.y
                            val len=hypot(dx,dy)
                            if(len>1f) {
                                val ux=dx/len;val uy=dy/len
                                val tip=minOf(10.dp.toPx(),len*.4f)
                                val base=Offset(z.x-ux*tip,z.y-uy*tip)
                                drawLine(ink,z,Offset(base.x-uy*tip*.5f,base.y+ux*tip*.5f),stroke)
                                drawLine(ink,z,Offset(base.x+uy*tip*.5f,base.y-ux*tip*.5f),stroke)
                            }
                        }
                    }
                    "CIRCLE" -> drawCircle(accent,minOf(width,height)*c[2]/100f,a,style=Stroke(stroke))
                    "RECT","ELLIPSE" -> {
                        val z=point(c[2],c[3]); val bounds=Size(z.x-a.x,z.y-a.y)
                        if(command.kind=="RECT") drawRect(accent,a,bounds,style=Stroke(stroke))
                        else drawOval(accent,a,bounds,style=Stroke(stroke))
                    }
                    "CURVE" -> {
                        val control=point(c[2],c[3]);val z=point(c[4],c[5])
                        val path=Path().apply { moveTo(a.x,a.y);quadraticBezierTo(control.x,control.y,z.x,z.y) }
                        drawPath(path,accent,style=Stroke(stroke))
                    }
                    "LABEL" -> {
                        val measured=labelPaint.measureText(command.label)
                        val x=a.x.coerceIn(0f,(size.width-measured).coerceAtLeast(0f))
                        val y=a.y.coerceIn(labelPaint.textSize,size.height.coerceAtLeast(labelPaint.textSize))
                        drawContext.canvas.nativeCanvas.drawText(command.label,x,y,labelPaint)
                    }
                }
            }
        }
        Text(scene.description,style=MaterialTheme.typography.bodySmall)
        Text("Conceptual illustration · Not to scale",color=muted,style=MaterialTheme.typography.labelSmall)
    }
}
