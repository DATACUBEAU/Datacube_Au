package au.datacube.app.ui.common

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

internal enum class TourPage { HOME, DOCUMENTS, GIST, SETTINGS, MODELS }
internal enum class TourTarget { DOCUMENTS, UPLOAD, GIST, GIST_INPUT, SETTINGS, MODELS, RECOMMEND, FOLDER }
internal enum class AuTourStep(val page:TourPage,val target:TourTarget,val title:String,val detail:String,val action:String) {
    DOCUMENTS(TourPage.HOME,TourTarget.DOCUMENTS,"Your library","Keep textbooks and related files together.","Open Documents"),
    UPLOAD(TourPage.DOCUMENTS,TourTarget.UPLOAD,"Add a document","Use Upload Documents to choose PDFs or text files. You can do this later.","Continue"),
    GIST(TourPage.HOME,TourTarget.GIST,"Ask AU","Gist is for questions with or without a textbook.","Open Gist"),
    INPUT(TourPage.GIST,TourTarget.GIST_INPUT,"Start a conversation","Type a question here. AU can explain difficult ideas with diagrams and step-by-step cards.","Continue"),
    SETTINGS(TourPage.HOME,TourTarget.SETTINGS,"Your preferences","Settings is where you manage AU, models and support.","Open Settings"),
    MODELS(TourPage.SETTINGS,TourTarget.MODELS,"Set up AI","Open Models to get the chat and search models. Voice is optional.","Open Models"),
    RECOMMEND(TourPage.MODELS,TourTarget.RECOMMEND,"Find the right models","AU checks memory and storage. Review its suggested chat, document search and optional voice models.","Continue"),
    FOLDER(TourPage.MODELS,TourTarget.FOLDER,"Prepare downloads","Choose a backup folder. Then review each model's size and confirm Wi-Fi or mobile data. Nothing downloads automatically.","Finish")
}

/** Bounds are scoped to mounted controls; old navigation destinations cannot remove a new registration. */
internal class AuSpotlightState {
    private data class Target(val owner:Any,val bounds:Rect)
    private val targets=mutableStateMapOf<TourTarget,Target>()
    var activeTarget by mutableStateOf<TourTarget?>(null)
    fun bounds(target:TourTarget):Rect? = targets[target]?.bounds
    fun register(target:TourTarget,owner:Any,bounds:Rect) {
        val value=Target(owner,bounds)
        if(targets[target]!=value) targets[target]=value
    }
    fun remove(target:TourTarget,owner:Any) {
        if(targets[target]?.owner===owner) targets.remove(target)
    }
}
internal val LocalAuSpotlight=compositionLocalOf<AuSpotlightState?> { null }

internal fun Modifier.auTourTarget(target:TourTarget):Modifier = composed {
    val registry=LocalAuSpotlight.current
    val owner=remember { Any() }
    DisposableEffect(registry,target,owner) {
        onDispose { registry?.remove(target,owner) }
    }
    if(registry==null) this else onGloballyPositioned { coordinates ->
        if(coordinates.isAttached) registry.register(target,owner,coordinates.boundsInRoot())
    }
}

/** A real overlay above the existing UI. Highlight taps advance the tour, never invoke underlying
 * uploads, model downloads, account actions, or other side effects. Missing targets still have
 * readable instructions and a working Continue/Skip. */
@Composable
internal fun AuSpotlightOverlay(state:AuSpotlightState,step:AuTourStep,index:Int,onNext:()->Unit,onSkip:()->Unit) {
    var origin by remember { mutableStateOf(Offset.Zero) }
    val target=state.bounds(step.target)
    val latestNext by rememberUpdatedState(onNext)
    val latestTarget by rememberUpdatedState(target)
    val latestOrigin by rememberUpdatedState(origin)
    BoxWithConstraints(Modifier.fillMaxSize().testTag("au-spotlight-overlay")
        .onGloballyPositioned { origin=it.positionInRoot() }
        .pointerInput(step) {
            detectTapGestures { touch ->
                val bounds=latestTarget
                if(bounds!=null && bounds.width>1f && bounds.height>1f &&
                    bounds.contains(touch+latestOrigin)) latestNext()
            }
        }) {
        val height=maxHeight
        val density=androidx.compose.ui.platform.LocalDensity.current
        val availableHeight=with(density){height.toPx()}
        val anchor=target?.takeIf { it.width>1f && it.height>1f }
        val top=anchor!=null && anchor.center.y-origin.y>availableHeight/2
        val outline=MaterialTheme.colorScheme.primary
        Canvas(Modifier.fillMaxSize()) {
            val hole=anchor?.let {
                Rect((it.left-origin.x-5.dp.toPx()).coerceIn(0f,size.width),
                    (it.top-origin.y-5.dp.toPx()).coerceIn(0f,size.height),
                    (it.right-origin.x+5.dp.toPx()).coerceIn(0f,size.width),
                    (it.bottom-origin.y+5.dp.toPx()).coerceIn(0f,size.height))
            }?.takeIf { it.width>1f && it.height>1f }
            val mask=Path().apply {
                fillType=PathFillType.EvenOdd
                addRect(Rect(Offset.Zero,size))
                if(hole!=null) addRoundRect(RoundRect(hole,CornerRadius(14.dp.toPx())))
            }
            drawPath(mask,Color.Black.copy(alpha=.72f))
            if(hole!=null) drawRoundRect(outline,topLeft=hole.topLeft,size=hole.size,
                cornerRadius=CornerRadius(14.dp.toPx()),style=Stroke(2.dp.toPx()))
        }
        Surface(
            modifier=Modifier.align(if(top) Alignment.TopCenter else Alignment.BottomCenter)
                .padding(12.dp).widthIn(max=460.dp).fillMaxWidth(),
            shape=RoundedCornerShape(20.dp),color=MaterialTheme.colorScheme.surface,
            shadowElevation=8.dp
        ) {
            Column(Modifier.heightIn(max=(height-24.dp).coerceAtLeast(80.dp))
                .verticalScroll(rememberScrollState()).padding(16.dp),
                verticalArrangement=Arrangement.spacedBy(10.dp)) {
                AuStepProgress(index,AuTourStep.entries.size)
                Text(step.title,style=MaterialTheme.typography.titleLarge,fontWeight=FontWeight.SemiBold,
                    modifier=Modifier.semantics { heading() })
                Text(step.detail,style=MaterialTheme.typography.bodyMedium)
                Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                    TextButton(onClick=onSkip,modifier=Modifier.weight(1f)){Text("Skip")}
                    Button(onClick=onNext,modifier=Modifier.weight(2f)){Text(step.action)}
                }
            }
        }
    }
}

@Composable
internal fun AuTutorialOffer(onStart:()->Unit,onDecline:()->Unit) {
    DataCubeDialog(onDismissRequest=onDecline,title={Text("Start a quick tutorial?")},
        text={Text("Explore AU's real screens and learn how to upload documents, ask questions and download the right models. You can skip anytime.")},
        confirmButton={Button(onClick=onStart){Text("Start tutorial")}},
        dismissButton={TextButton(onClick=onDecline){Text("Not now")}})
}
