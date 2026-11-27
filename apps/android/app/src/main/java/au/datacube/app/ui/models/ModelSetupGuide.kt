package au.datacube.app.ui.models

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import au.datacube.app.data.rag.LocalEmbeddingRuntime
import au.datacube.app.data.rag.LocalGenerativeEngine
import au.datacube.app.ui.common.DataCubeDialog
import au.datacube.app.ui.common.AuProjectileIllustration
import kotlinx.coroutines.launch

internal object ModelSetupGuide {
    const val OPEN_MODELS = "Open Models"
    const val FIND_MODELS = "Find best models"
    const val COMMUNITY_URL = "https://chat.whatsapp.com/DpSUsodSKvi4xcF1lpwdbN"
    data class Readiness(val chat: Boolean,val search: Boolean,val searchSupported: Boolean) {
        val needsSetup get() = !chat || (searchSupported && !search)
    }
    fun readiness(context:Context) = Readiness(LocalGenerativeEngine.installed(context),
        LocalEmbeddingRuntime.available(context),android.os.Build.VERSION.SDK_INT >= 28)
    fun missingText(state:Readiness):String = when {
        !state.chat && state.searchSupported && !state.search -> "Download a chat model for explanations and a search model to find related passages."
        !state.chat -> "Download a chat model to ask questions and create study notes."
        state.searchSupported && !state.search -> "Download the search model for semantic document search."
        else -> "Your models are ready."
    }
    fun openCommunity(context:Context):Boolean = runCatching {
        context.startActivity(Intent(Intent.ACTION_VIEW,Uri.parse(COMMUNITY_URL))); true
    }.getOrDefault(false)
}

@Composable
internal fun ModelSetupTour(onDismiss:()->Unit,onOpenModels:()->Unit) {
    val pager=rememberPagerState(pageCount={4})
    val scope=rememberCoroutineScope()
    val titles=listOf("Welcome to AU","Set up AU","See the idea","A few things to know")
    DataCubeDialog(
        onDismissRequest=onDismiss,
        title={ Text(titles[pager.currentPage],style=MaterialTheme.typography.headlineSmall,fontWeight=FontWeight.SemiBold) },
        text={
            Column(verticalArrangement=Arrangement.spacedBy(10.dp)) {
                HorizontalPager(state=pager,modifier=Modifier.fillMaxWidth().height(280.dp)) { page ->
                    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal=2.dp),
                        verticalArrangement=Arrangement.spacedBy(10.dp)) {
                        when(page) {
                            0 -> {
                                Text("Import a textbook, ask questions, create Smart Notes or study with Gist.")
                                GuideStep("1", "Home", "Open documents and collections.")
                                GuideStep("2", "Settings", "Tap Models whenever you need to set up or change AU.")
                                GuideStep("3", "Models", "Choose a chat model and a search model.")
                            }
                            1 -> {
                                Text("Tap Find best models to check your phone's memory and available storage. No personal files are scanned.")
                                GuideStep("1","Chat","Explains, reasons and creates notes.")
                                GuideStep("2","Search","Finds related document passages.")
                                GuideStep("3","Voice (optional)","Natural read-aloud and podcasts.")
                                GuideStep("4","Choose a backup folder","Select Documents or an SD card. Then tap Download on each recommended model.")
                                Text("Review the download sizes. Choose Wi-Fi or mobile data before confirming.",
                                    style=MaterialTheme.typography.bodySmall)
                            }
                            2 -> {
                                Text("AU can add a diagram when it helps explain a concept.",style=MaterialTheme.typography.bodyMedium)
                                AuProjectileIllustration()
                            }
                            3 -> {
                                Text("Core offline study does not require ads. If optional rewarded features become available, AU will show what an ad unlocks before you choose to watch.")
                                Text("For help and updates, find the optional WhatsApp community in Settings. Avoid sharing private files or account information.",
                                    style=MaterialTheme.typography.bodyMedium)
                                Text("You can reopen this guide in Settings at any time.",style=MaterialTheme.typography.bodySmall)
                            }
                        }
                    }
                }
                au.datacube.app.ui.common.AuStepProgress(pager.currentPage,4)
                if (pager.currentPage > 0) TextButton(onClick={scope.launch {
                    pager.animateScrollToPage(pager.currentPage-1)
                }}) { Text("Previous") }
            }
        },
        confirmButton={
            Button(onClick={
                if(pager.currentPage==3) onOpenModels()
                else scope.launch { pager.animateScrollToPage(pager.currentPage+1) }
            }) { Text(if(pager.currentPage==3) ModelSetupGuide.OPEN_MODELS else "Next") }
        },
        dismissButton={ TextButton(onClick=onDismiss) { Text("Skip") } }
    )
}

@Composable
private fun GuideStep(number:String,title:String,detail:String) {
    Surface(shape=RoundedCornerShape(12.dp),border=BorderStroke(1.dp,MaterialTheme.colorScheme.outlineVariant)) {
        Row(Modifier.fillMaxWidth().padding(10.dp),verticalAlignment=Alignment.CenterVertically,
            horizontalArrangement=Arrangement.spacedBy(10.dp)) {
            Text(number,color=MaterialTheme.colorScheme.primary,fontWeight=FontWeight.Bold)
            Column(Modifier.weight(1f)) {
                Text(title,fontWeight=FontWeight.SemiBold)
                Text(detail,style=MaterialTheme.typography.bodySmall)
            }
        }
    }
}

@Composable
internal fun MissingModelPrompt(state:ModelSetupGuide.Readiness,onDismiss:()->Unit,
                                onOpenModels:()->Unit,onImportAnyway:()->Unit) {
    DataCubeDialog(onDismissRequest=onDismiss,title={Text("Set up AU first?")},
        text={Column(verticalArrangement=Arrangement.spacedBy(8.dp)){
            Text(ModelSetupGuide.missingText(state))
            Text("You can still import and read documents without AI. Return here when your models are ready.",style=MaterialTheme.typography.bodySmall)
        }},
        confirmButton={Button(onClick=onOpenModels){Text(ModelSetupGuide.OPEN_MODELS)}},
        dismissButton={TextButton(onClick=onImportAnyway){Text("Import anyway")}})
}

@Composable
internal fun CommunityInviteDialog(onDismiss:()->Unit,onJoin:()->Unit) {
    DataCubeDialog(onDismissRequest=onDismiss,
        title={Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(10.dp)){
            WhatsAppCommunityIcon()
            Text("Join the AU community",style=MaterialTheme.typography.titleLarge,fontWeight=FontWeight.SemiBold)
        }},
        text={Column(verticalArrangement=Arrangement.spacedBy(10.dp)){
            Text("Learn how to use AU, share feedback and receive product updates.")
            Text("Joining is optional. WhatsApp members may see your phone number or profile. Avoid sharing private documents, passwords or personal information.",
                style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        }},
        confirmButton={Button(onClick=onJoin){Text("Open WhatsApp")}},
        dismissButton={TextButton(onClick=onDismiss){Text("Not now")}})
}

@Composable
internal fun WhatsAppCommunityIcon(modifier:Modifier=Modifier) {
    val green=androidx.compose.ui.graphics.Color(0xFF128C7E)
    Box(modifier.size(36.dp),contentAlignment=Alignment.Center) {
        Icon(Icons.Outlined.ChatBubbleOutline,null,tint=green,modifier=Modifier.fillMaxSize())
        Icon(Icons.Outlined.Call,null,tint=green,modifier=Modifier.size(18.dp).offset(y=(-2).dp))
    }
}
