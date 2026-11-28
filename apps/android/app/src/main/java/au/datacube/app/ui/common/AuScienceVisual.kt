package au.datacube.app.ui.common

import android.graphics.Bitmap
import android.graphics.Canvas as NativeCanvas
import android.graphics.Color as NativeColor
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Typeface
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import au.datacube.app.data.rag.AuScienceTemplate
import au.datacube.app.data.rag.AuWaveParameters
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.Locale
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin

/** One deterministic drawing function for display and image export. No model code execution. */
internal object AuScienceRenderer {
    private const val W = 640f
    private const val H = 420f
    private val ink = NativeColor.rgb(30, 49, 65)
    private val muted = NativeColor.rgb(76, 97, 113)
    private val blue = NativeColor.rgb(38, 112, 177)
    private val green = NativeColor.rgb(39, 133, 108)
    private val purple = NativeColor.rgb(125, 83, 164)
    private val paleGreen = NativeColor.rgb(216, 241, 224)
    private val paleBlue = NativeColor.rgb(218, 237, 251)
    private val paper = NativeColor.rgb(250, 252, 254)

    fun draw(canvas: NativeCanvas, width: Float, height: Float, template: AuScienceTemplate, wave: AuWaveParameters) {
        if (width <= 0f || height <= 0f) return
        val save = canvas.save()
        canvas.clipRect(0f,0f,width,height)
        canvas.drawColor(paper)
        val scale = minOf(width / W, height / H)
        canvas.translate((width - W * scale) / 2, (height - H * scale) / 2)
        canvas.scale(scale, scale)
        val p = Paint(Paint.ANTI_ALIAS_FLAG).apply { strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND }
        fun line(x: Float, y: Float, x2: Float, y2: Float, color: Int = ink, stroke: Float = 2f) {
            p.color = color; p.style = Paint.Style.STROKE; p.strokeWidth = stroke
            canvas.drawLine(x, y, x2, y2, p)
        }
        fun arrow(x: Float, y: Float, x2: Float, y2: Float, color: Int = blue) {
            line(x, y, x2, y2, color, 3f)
            val a = atan2((y2-y).toDouble(), (x2-x).toDouble())
            for (delta in listOf(-.5, .5)) line(x2, y2,
                x2 - (12 * cos(a + delta)).toFloat(), y2 - (12 * sin(a + delta)).toFloat(), color, 3f)
        }
        fun text(value: String, x: Float, y: Float, color: Int = ink, size: Float = 16f, bold: Boolean = false) {
            p.style = Paint.Style.FILL; p.color = color; p.textSize = size
            p.typeface = Typeface.create("sans-serif", if (bold) Typeface.BOLD else Typeface.NORMAL)
            canvas.drawText(value, x, y, p)
        }
        fun oval(x: Float, y: Float, x2: Float, y2: Float, fill: Int, outline: Int = green) {
            p.style = Paint.Style.FILL; p.color = fill; canvas.drawOval(x, y, x2, y2, p)
            p.style = Paint.Style.STROKE; p.color = outline; p.strokeWidth = 2f; canvas.drawOval(x, y, x2, y2, p)
        }
        fun rect(x: Float, y: Float, x2: Float, y2: Float, fill: Int, outline: Int, radius: Float = 12f) {
            p.style = Paint.Style.FILL; p.color = fill; canvas.drawRoundRect(x,y,x2,y2,radius,radius,p)
            p.style = Paint.Style.STROKE; p.color = outline; p.strokeWidth = 2.5f; canvas.drawRoundRect(x,y,x2,y2,radius,radius,p)
        }
        text(template.title, 24f, 32f, ink, 23f, true)
        when (template) {
            AuScienceTemplate.PLANT_CELL -> {
                rect(36f,66f,394f,366f,paleGreen,green,28f)
                rect(49f,79f,381f,353f,NativeColor.rgb(241,249,234),green,22f)
                oval(126f,112f,353f,303f,paleBlue,blue)
                oval(67f,220f,138f,288f,NativeColor.rgb(229,215,245),purple)
                oval(86f,240f,117f,269f,purple,purple)
                listOf(85f to 115f, 72f to 175f, 318f to 319f, 160f to 321f, 299f to 91f).forEach { (x,y) ->
                    oval(x,y,x+52,y+23,NativeColor.rgb(135,204,156),green)
                    for (d in 1..3) line(x+10+d*8,y+5,x+10+d*8,y+18,green,1.5f)
                }
                fun leader(x:Float,y:Float,endY:Float,label:String,color:Int) {
                    line(x,y,411f,endY,color); line(411f,endY,434f,endY,color)
                    text(label,442f,endY+5,color,16f,true)
                }
                leader(393f,78f,76f,"Cell wall",green)
                leader(379f,112f,130f,"Cell membrane",green)
                leader(337f,171f,186f,"Central vacuole",blue)
                leader(127f,257f,260f,"Nucleus",purple)
                leader(345f,330f,330f,"Chloroplast",green)
            }
            AuScienceTemplate.WATER_CYCLE -> {
                oval(40f,75f,106f,141f,NativeColor.rgb(255,220,127),NativeColor.rgb(195,137,42))
                oval(236f,83f,351f,147f,paleBlue,blue)
                oval(304f,68f,423f,150f,paleBlue,blue)
                oval(385f,91f,478f,150f,paleBlue,blue)
                text("Condensation",272f,62f,blue,16f,true)
                val mountain = Path().apply { moveTo(322f,318f); lineTo(460f,198f); lineTo(586f,318f); close() }
                p.style=Paint.Style.FILL; p.color=NativeColor.rgb(190,220,194); canvas.drawPath(mountain,p)
                rect(40f,318f,596f,375f,paleBlue,blue,15f)
                text("Collection",258f,352f,blue,17f,true)
                arrow(145f,306f,145f,178f)
                arrow(153f,174f,238f,132f)
                text("Evaporation",36f,223f,blue,16f,true)
                for (x in listOf(355f,395f,435f)) arrow(x,158f,x-13f,238f)
                text("Precipitation",461f,178f,blue,16f,true)
                arrow(492f,260f,404f,307f,green)
                text("Runoff",495f,286f,green,16f,true)
            }
            AuScienceTemplate.PARALLEL_LINES -> {
                for (y in listOf(126f,226f)) {
                    arrow(76f,y+72f,555f,y-52f,blue)
                    arrow(555f,y-52f,76f,y+72f,blue)
                    // Matching direction markers are offset copies.
                    val cx=320f; val cy=y+9f
                    line(cx-8,cy-9,cx+3,cy,green,3f)
                    line(cx+3,cy,cx-3,cy+12,green,3f)
                }
                text("Line a",550f,67f,blue,16f,true)
                text("Line b",550f,167f,blue,16f,true)
                text("Same direction • constant perpendicular separation",55f,340f,ink,19f,true)
                text("The lines never intersect when extended.",55f,374f,muted,16f)
            }
            AuScienceTemplate.SINE_WAVE -> {
                val left=62f; val right=602f; val top=70f; val bottom=350f
                val mid=(top+bottom)/2
                val unit=(bottom-top)/4
                for (i in -2..2) {
                    val y=mid-i*unit
                    line(left,y,right,y,NativeColor.rgb(215,226,234),1f)
                    text(i.toString(),28f,y+5,muted,14f)
                }
                for (i in 0..4) {
                    val x=left+(right-left)*i/4
                    line(x,top,x,bottom,NativeColor.rgb(215,226,234),1f)
                    text(String.format(Locale.ROOT,"%.2f",i/4.0),x-15,bottom+20,muted,13f)
                }
                line(left,top,left,bottom,ink); line(left,mid,right,mid,ink)
                val path=Path()
                for (i in 0..320) {
                    val t=i/320.0
                    val x=left+(right-left)*t.toFloat()
                    val y=mid-wave.displacement(t).toFloat()*unit
                    if(i==0) path.moveTo(x,y) else path.lineTo(x,y)
                }
                p.style=Paint.Style.STROKE; p.color=blue; p.strokeWidth=3f; canvas.drawPath(path,p)
                text("Displacement",62f,57f,muted,14f,true)
                text("Time (s)",533f,397f,ink,14f,true)
                text(String.format(Locale.ROOT,"A = %.1f   f = %.1f Hz",wave.amplitude,wave.frequency),65f,397f,ink,16f,true)
            }
        }
        if(template != AuScienceTemplate.SINE_WAVE) text("Conceptual illustration · not to scale",24f,405f,muted,13f)
        canvas.restoreToCount(save)
    }

    fun bitmap(template: AuScienceTemplate, wave: AuWaveParameters): Bitmap =
        Bitmap.createBitmap(1280,840,Bitmap.Config.ARGB_8888).also { draw(NativeCanvas(it),1280f,840f,template,wave) }
}

@Composable
internal fun AuScienceVisual(template: AuScienceTemplate) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var expanded by remember(template) { mutableStateOf(false) }
    var zoom by remember(template) { mutableFloatStateOf(1f) }
    var amplitude by remember(template) { mutableFloatStateOf(1f) }
    var frequency by remember(template) { mutableFloatStateOf(2f) }
    var saving by remember(template) { mutableStateOf(false) }
    var message by remember(template) { mutableStateOf<String?>(null) }
    val wave = AuWaveParameters(amplitude,frequency)
    var exportWave by remember(template) { mutableStateOf(wave) }
    val saveImage = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("image/png")) { uri ->
        if (uri != null && !saving) {
            saving = true
            val parameters = exportWave
            scope.launch {
                try {
                    withContext(Dispatchers.IO) {
                        val image = AuScienceRenderer.bitmap(template,parameters)
                        try {
                            val out = requireNotNull(context.contentResolver.openOutputStream(uri,"w"))
                            out.use { check(image.compress(Bitmap.CompressFormat.PNG,100,it)) }
                        } finally { image.recycle() }
                    }
                    message = "Diagram saved as PNG."
                } catch (cancelled: CancellationException) { throw cancelled }
                catch (_: Exception) { message = "Could not save the image. Try another location." }
                finally { saving = false }
            }
        }
    }
    fun export() { exportWave = wave; saveImage.launch("AU-" + template.key + ".png") }

    Surface(shape = RoundedCornerShape(16.dp), border = BorderStroke(1.dp,MaterialTheme.colorScheme.outlineVariant),
        modifier=Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
            ScienceCanvas(template,wave,Modifier.fillMaxWidth().aspectRatio(640f/420f))
            Text(template.description,style=MaterialTheme.typography.bodySmall)
            Text("General educational illustration",style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            if(template == AuScienceTemplate.SINE_WAVE) {
                WaveControls(amplitude,frequency,{amplitude=it},{frequency=it})
            }
            Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween) {
                TextButton(onClick={zoom=1f; expanded=true}) { Text("Expand") }
                TextButton(onClick={export()},enabled=!saving) { Text(if(saving) "Saving…" else "Save PNG") }
            }
            message?.let { Text(it,style=MaterialTheme.typography.labelSmall) }
        }
    }
    if(expanded) Dialog(onDismissRequest={expanded=false},properties=DialogProperties(usePlatformDefaultWidth=false)) {
        Surface(Modifier.fillMaxWidth(.96f).fillMaxHeight(.9f),shape=RoundedCornerShape(20.dp)) {
            Column(Modifier.padding(12.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
                Text(template.title,style=MaterialTheme.typography.titleLarge)
                Row(verticalAlignment=Alignment.CenterVertically) {
                    TextButton(onClick={zoom=(zoom-.5f).coerceAtLeast(1f)},enabled=zoom>1f) { Text("−") }
                    Text(String.format(Locale.ROOT,"%.1f×",zoom))
                    TextButton(onClick={zoom=(zoom+.5f).coerceAtMost(3f)},enabled=zoom<3f) { Text("+") }
                    Spacer(Modifier.weight(1f))
                    TextButton(onClick={expanded=false}) { Text("Close") }
                }
                BoxWithConstraints(Modifier.weight(1f).fillMaxWidth()) {
                    val pictureWidth=maxWidth*zoom
                    Box(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).horizontalScroll(rememberScrollState())) {
                        ScienceCanvas(template,wave,Modifier.requiredWidth(pictureWidth).aspectRatio(640f/420f))
                    }
                }
                if(template == AuScienceTemplate.SINE_WAVE) {
                    WaveControls(amplitude,frequency,{amplitude=it},{frequency=it})
                }
                TextButton(onClick={export()},enabled=!saving) { Text("Save PNG") }
                message?.let { Text(it,style=MaterialTheme.typography.labelSmall) }
            }
        }
    }
}

@Composable
private fun ScienceCanvas(template: AuScienceTemplate,wave: AuWaveParameters,modifier: Modifier) {
    Canvas(modifier.semantics { contentDescription=template.description }) {
        AuScienceRenderer.draw(drawContext.canvas.nativeCanvas,size.width,size.height,template,wave)
    }
}

@Composable
private fun WaveControls(amplitude: Float,frequency: Float,onAmplitude:(Float)->Unit,onFrequency:(Float)->Unit) {
    Text(String.format(Locale.ROOT,"Amplitude %.1f",amplitude),style=MaterialTheme.typography.labelMedium)
    Slider(value=amplitude,onValueChange=onAmplitude,valueRange=.5f..2f,steps=14)
    Text(String.format(Locale.ROOT,"Frequency %.1f Hz",frequency),style=MaterialTheme.typography.labelMedium)
    Slider(value=frequency,onValueChange=onFrequency,valueRange=1f..4f,steps=29)
}
