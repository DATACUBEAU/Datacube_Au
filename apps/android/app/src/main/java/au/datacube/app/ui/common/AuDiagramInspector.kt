package au.datacube.app.ui.common

import android.graphics.Bitmap
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.rememberGraphicsLayer
import androidx.compose.ui.graphics.layer.drawLayer
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.math.roundToInt
import java.util.Locale

/** Capture only the diagram, not the surrounding chat. Allocate a bitmap only on demand. */
@Composable
internal fun AuDiagramInspector(title: String, content: @Composable () -> Unit) {
    var expanded by remember(title) { mutableStateOf(false) }
    var zoom by remember(title) { mutableFloatStateOf(1f) }
    Column(Modifier.fillMaxWidth(),verticalArrangement=Arrangement.spacedBy(4.dp)) {
        content()
        TextButton(onClick={zoom=1f;expanded=true}) { Text("Expand diagram") }
    }
    if (expanded) Dialog(onDismissRequest={expanded=false},properties=DialogProperties(usePlatformDefaultWidth=false)) {
        val context=LocalContext.current
        val scope=rememberCoroutineScope()
        val layer=rememberGraphicsLayer()
        var saving by remember { mutableStateOf(false) }
        var result by remember { mutableStateOf<String?>(null) }
        var pending by remember { mutableStateOf<Bitmap?>(null) }
        DisposableEffect(Unit) { onDispose { pending?.recycle(); pending=null } }
        val save=rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("image/png")) { uri ->
            val bitmap=pending
            pending=null
            if(uri==null || bitmap==null) {
                bitmap?.recycle();saving=false
            } else scope.launch {
                try {
                    withContext(Dispatchers.IO) {
                        requireNotNull(context.contentResolver.openOutputStream(uri,"w")).use {
                            check(bitmap.compress(Bitmap.CompressFormat.PNG,100,it))
                        }
                    }
                    result="Diagram saved as PNG."
                } catch(cancelled:CancellationException) { throw cancelled }
                catch(_:Exception) { result="Could not save the diagram." }
                finally { bitmap.recycle();saving=false }
            }
        }
        Surface(Modifier.fillMaxWidth(.96f).fillMaxHeight(.90f),shape=RoundedCornerShape(20.dp)) {
            Column(Modifier.padding(12.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
                Text(title,style=MaterialTheme.typography.titleLarge)
                Row(verticalAlignment=Alignment.CenterVertically) {
                    TextButton(onClick={zoom=(zoom-.5f).coerceAtLeast(1f)},enabled=zoom>1f) { Text("−") }
                    Text(String.format(Locale.ROOT,"%.1f×",zoom))
                    TextButton(onClick={zoom=(zoom+.5f).coerceAtMost(3f)},enabled=zoom<3f) { Text("+") }
                    Spacer(Modifier.weight(1f))
                    TextButton(onClick={expanded=false}) { Text("Close") }
                }
                BoxWithConstraints(Modifier.weight(1f).fillMaxWidth()) {
                    val naturalWidth=maxWidth
                    Box(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).horizontalScroll(rememberScrollState())) {
                        Box(Modifier.layout { measurable,constraints ->
                            val p=measurable.measure(constraints)
                            layout((p.width*zoom).roundToInt(),(p.height*zoom).roundToInt()) {
                                p.placeRelativeWithLayer(0,0) {
                                    scaleX=zoom;scaleY=zoom;transformOrigin=TransformOrigin(0f,0f)
                                }
                            }
                        }.requiredWidth(naturalWidth).drawWithContent {
                            layer.record { this@drawWithContent.drawContent() }
                            drawLayer(layer)
                        }.background(MaterialTheme.colorScheme.surface).padding(10.dp)) { content() }
                    }
                }
                TextButton(enabled=!saving,onClick={
                    saving=true
                    scope.launch {
                        try {
                            val pixels=layer.size.width.toLong()*layer.size.height
                            require(pixels in 1L..4_000_000L) { "Diagram exceeds the image export limit." }
                            pending=layer.toImageBitmap().asAndroidBitmap()
                            save.launch("AU-diagram.png")
                        } catch(cancelled:CancellationException) { throw cancelled }
                        catch(_:Exception) {
                            pending?.recycle();pending=null;saving=false;result="Could not prepare the diagram image."
                        }
                    }
                }) { Text(if(saving) "Preparing…" else "Save PNG") }
                result?.let { Text(it,style=MaterialTheme.typography.labelSmall) }
            }
        }
    }
}
