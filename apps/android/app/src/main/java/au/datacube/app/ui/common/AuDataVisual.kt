package au.datacube.app.ui.common

import android.graphics.Paint
import android.graphics.Typeface
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import au.datacube.app.data.rag.*
import java.util.Locale
import kotlin.math.*

private fun number(value: Double): String =
    if (abs(value) >= 10000 || (value != 0.0 && abs(value) < .001))
        String.format(Locale.ROOT,"%.2e",value)
    else String.format(Locale.ROOT,"%.3f",value).trimEnd('0').trimEnd('.').let { if(it=="-0") "0" else it }

@Composable
internal fun AuNumericPlot(data: AuPlotData) {
    val ink = MaterialTheme.colorScheme.onSurface
    val accent = MaterialTheme.colorScheme.primary
    val grid = MaterialTheme.colorScheme.outlineVariant
    val bounds = remember(data) {
        fun extent(values: List<Double>): Pair<Double,Double> {
            val lo=values.min(); val hi=values.max()
            val pad=if(lo==hi) max(1.0,abs(lo)*.05) else (hi-lo)*.06
            return lo-pad to hi+pad
        }
        extent(data.series.map { it.x }) to extent(data.series.map { it.y })
    }
    Column(Modifier.fillMaxWidth(),verticalArrangement=Arrangement.spacedBy(6.dp)) {
        Text(data.title,style=MaterialTheme.typography.titleMedium)
        Text(data.yLabel,style=MaterialTheme.typography.labelMedium)
        Canvas(Modifier.fillMaxWidth().aspectRatio(1.45f).semantics {
            contentDescription="${data.title}. ${data.series.size} points. Horizontal axis ${data.xLabel}, vertical axis ${data.yLabel}."
        }) {
            val left=62.dp.toPx(); val right=(size.width-12.dp.toPx()).coerceAtLeast(left+1)
            val top=12.dp.toPx(); val bottom=(size.height-28.dp.toPx()).coerceAtLeast(top+1)
            val (xRange,yRange)=bounds
            fun x(v:Double)=left+((v-xRange.first)/(xRange.second-xRange.first)).toFloat()*(right-left)
            fun y(v:Double)=bottom-((v-yRange.first)/(yRange.second-yRange.first)).toFloat()*(bottom-top)
            val paint=Paint(Paint.ANTI_ALIAS_FLAG).apply { color=ink.toArgb();textSize=10.dp.toPx() }
            for(i in 0..4) {
                val xv=xRange.first+(xRange.second-xRange.first)*i/4
                val yv=yRange.first+(yRange.second-yRange.first)*i/4
                drawLine(grid,Offset(x(xv),top),Offset(x(xv),bottom),1.dp.toPx())
                drawLine(grid,Offset(left,y(yv)),Offset(right,y(yv)),1.dp.toPx())
                val label=number(xv)
                drawContext.canvas.nativeCanvas.drawText(label,(x(xv)-paint.measureText(label)/2).coerceIn(0f,(size.width-paint.measureText(label)).coerceAtLeast(0f)),bottom+15.dp.toPx(),paint)
                drawContext.canvas.nativeCanvas.drawText(number(yv),2.dp.toPx(),y(yv)+3.dp.toPx(),paint)
            }
            if(0.0 in xRange.first..xRange.second) drawLine(ink,Offset(x(0.0),top),Offset(x(0.0),bottom),1.dp.toPx())
            if(0.0 in yRange.first..yRange.second) drawLine(ink,Offset(left,y(0.0)),Offset(right,y(0.0)),1.dp.toPx())
            val points=data.series.map { Offset(x(it.x),y(it.y)) }
            if(!data.scatter) points.zipWithNext().forEach { (a,b) -> drawLine(accent,a,b,2.dp.toPx()) }
            if(data.scatter || points.size<=32) points.forEach { drawCircle(accent,3.dp.toPx(),it) }
        }
        Text(data.xLabel,style=MaterialTheme.typography.labelMedium)
    }
}

/** Node IDs describe relationships; no inferred edges or model-supplied coordinates. */
@Composable
internal fun AuRelationshipMap(data: AuMapData) {
    val ink=MaterialTheme.colorScheme.onSurface
    val edge=MaterialTheme.colorScheme.primary
    val fill=MaterialTheme.colorScheme.surfaceVariant
    val outline=MaterialTheme.colorScheme.outline
    Column(Modifier.fillMaxWidth(),verticalArrangement=Arrangement.spacedBy(6.dp)) {
        Text(data.title,style=MaterialTheme.typography.titleMedium)
        Canvas(Modifier.fillMaxWidth().height(maxOf(220, data.nodes.size*44).dp).semantics {
            contentDescription=data.edges.joinToString("; ") { e ->
                "${data.nodes.first{it.id==e.from}.label} ${e.label} ${data.nodes.first{it.id==e.to}.label}"
            }
        }) {
            // Convex perimeter placement keeps chords away from unrelated nodes.
            // Edge crossings are possible, but never introduce extra graph vertices.
            val count=data.nodes.size
            val boxW=size.width*if(count<=4) .30f else .23f
            val boxH=44.dp.toPx().coerceAtMost(size.height*.22f)
            val radiusX=(size.width-boxW)/2-5.dp.toPx()
            val radiusY=(size.height-boxH)/2-5.dp.toPx()
            val centers=data.nodes.mapIndexed { i,n ->
                val angle=if(count==2) i*PI else 2*PI*i/count-PI/2
                n.id to Offset(size.width/2+radiusX*cos(angle).toFloat(),size.height/2+radiusY*sin(angle).toFloat())
            }.toMap()
            val paint=Paint(Paint.ANTI_ALIAS_FLAG).apply { color=ink.toArgb();textSize=11.dp.toPx();typeface=Typeface.create("sans-serif",Typeface.NORMAL) }
            fun border(a:Offset,b:Offset):Offset {
                val d=b-a
                val factor=minOf(if(abs(d.x)>0) boxW/2/abs(d.x) else Float.MAX_VALUE,if(abs(d.y)>0) boxH/2/abs(d.y) else Float.MAX_VALUE)
                return a+d*factor
            }
            data.edges.forEachIndexed { i,e ->
                val a=centers.getValue(e.from);val b=centers.getValue(e.to)
                val direction=b-a
                val reverse=data.edges.any { it.from==e.to && it.to==e.from }
                val shift=if(reverse && direction.getDistance()>1f)
                    Offset(-direction.y,direction.x)/direction.getDistance()*4.dp.toPx() else Offset.Zero
                val start=border(a,b)+shift;val end=border(b,a)+shift
                drawLine(edge,start,end,1.5.dp.toPx())
                val delta=end-start
                val len=delta.getDistance()
                if(len>1) {
                    val u=delta/len; val v=Offset(-u.y,u.x); val tip=7.dp.toPx()
                    drawLine(edge,end,end-u*tip+v*tip*.5f,1.5.dp.toPx())
                    drawLine(edge,end,end-u*tip-v*tip*.5f,1.5.dp.toPx())
                }
                val middle=(start+end)/2f
                val dot=9.dp.toPx()
                drawCircle(fill,dot,middle)
                drawCircle(edge,dot,middle,style=Stroke(1.dp.toPx()))
                val label=(i+1).toString()
                paint.textSize=9.dp.toPx()
                drawContext.canvas.nativeCanvas.drawText(label,middle.x-paint.measureText(label)/2,middle.y-(paint.ascent()+paint.descent())/2,paint)
            }
            data.nodes.forEach { n ->
                val c=centers.getValue(n.id);val top=Offset(c.x-boxW/2,c.y-boxH/2)
                drawRoundRect(fill,top,Size(boxW,boxH),CornerRadius(8.dp.toPx()))
                drawRoundRect(outline,top,Size(boxW,boxH),CornerRadius(8.dp.toPx()),style=Stroke(1.dp.toPx()))
                // Fit long labels without clipping. Full text is also provided below in the relationship key.
                val label=n.label
                paint.textSize=11.dp.toPx()
                val maxWidth=(boxW-10.dp.toPx()).coerceAtLeast(1f)
                if(paint.measureText(label)>maxWidth) paint.textSize=(paint.textSize*maxWidth/paint.measureText(label)).coerceAtLeast(7.dp.toPx())
                val displayed=android.text.TextUtils.ellipsize(label,android.text.TextPaint(paint),maxWidth,android.text.TextUtils.TruncateAt.END).toString()
                drawContext.canvas.nativeCanvas.drawText(displayed,c.x-paint.measureText(displayed)/2,c.y-(paint.ascent()+paint.descent())/2,paint)
            }
        }
        Text("Relationships",style=MaterialTheme.typography.labelMedium)
        val names=data.nodes.associate { it.id to it.label }
        data.edges.forEachIndexed { index,e -> Text("${index+1}. ${names[e.from]} → ${names[e.to]}: ${e.label}",style=MaterialTheme.typography.bodySmall) }
    }
}

@Composable
internal fun AuLearningSimulation(kind: AuSimulationKind) {
    var a by remember(kind) { mutableFloatStateOf(1f) }
    var b by remember(kind) { mutableFloatStateOf(0f) }
    var c by remember(kind) { mutableFloatStateOf(0f) }
    var length by remember(kind) { mutableFloatStateOf(1f) }
    var gravity by remember(kind) { mutableFloatStateOf(9.81f) }
    val plot=remember(kind,a,b,c,length,gravity) {
        when(kind) {
            AuSimulationKind.QUADRATIC -> AuQuadratic(a.toDouble(),b.toDouble(),c.toDouble()).plot()
            AuSimulationKind.PENDULUM -> AuPendulum(length.toDouble(),gravity.toDouble()).plot()
        }
    }
    Column(Modifier.fillMaxWidth(),verticalArrangement=Arrangement.spacedBy(5.dp)) {
        Text(kind.title,style=MaterialTheme.typography.titleMedium)
        Text(kind.description,style=MaterialTheme.typography.bodySmall)
        Text("Illustrative adjustable model · not measured source data",style=MaterialTheme.typography.labelSmall)
        AuDiagramInspector(kind.title) { AuNumericPlot(plot) }
        when(kind) {
            AuSimulationKind.QUADRATIC -> {
                Parameter("a",a,-3f..3f,{a=it})
                Parameter("b",b,-4f..4f,{b=it})
                Parameter("c",c,-5f..5f,{c=it})
                if(a!=0f) Text("Vertex x = "+number(-b.toDouble()/(2*a)),style=MaterialTheme.typography.bodySmall)
                else Text("a = 0: linear or constant function.",style=MaterialTheme.typography.bodySmall)
            }
            AuSimulationKind.PENDULUM -> {
                Parameter("Length (m)",length,.25f..3f,{length=it})
                Parameter("Gravity (m/s²)",gravity,1f..20f,{gravity=it})
                Text("Period: "+number(AuPendulum(length.toDouble(),gravity.toDouble()).period)+" s",style=MaterialTheme.typography.bodyMedium)
            }
        }
        TextButton(onClick={a=1f;b=0f;c=0f;length=1f;gravity=9.81f}) { Text("Reset simulation") }
    }
}

@Composable
private fun Parameter(label:String,value:Float,range:ClosedFloatingPointRange<Float>,change:(Float)->Unit) {
    Text(label+": "+number(value.toDouble()),style=MaterialTheme.typography.labelMedium)
    Slider(value=value,onValueChange=change,valueRange=range)
}
