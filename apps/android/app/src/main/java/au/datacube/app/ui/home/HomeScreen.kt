package au.datacube.app.ui.home
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import au.datacube.app.data.LocalDocumentProcessing
import au.datacube.app.ui.theme.DataCubeColors
import io.github.jan.supabase.auth.user.UserInfo
@Composable fun HomeScreen(modifier:Modifier=Modifier,user:UserInfo?,recentDocuments:List<LocalDocumentProcessing>,onImportDocument:()->Unit,onNavigateToDocuments:()->Unit,onNavigateToStudy:()->Unit,onNavigateToChat:()->Unit){
 LazyColumn(modifier.fillMaxSize().background(DataCubeColors.BluePale),contentPadding=PaddingValues(20.dp),verticalArrangement=Arrangement.spacedBy(20.dp)){
  item{Column{Text("DataCube AU",style=MaterialTheme.typography.headlineLarge,fontWeight=FontWeight.Bold,color=DataCubeColors.Navy);Spacer(Modifier.height(5.dp));Text("Chat, analyze, and get insights from your documents.",color=DataCubeColors.TextSecondary,style=MaterialTheme.typography.bodyLarge);Spacer(Modifier.height(18.dp));Row(horizontalArrangement=Arrangement.spacedBy(10.dp)){Button(onClick=onNavigateToChat,shape=RoundedCornerShape(15.dp)){Icon(Icons.Outlined.Chat,null);Spacer(Modifier.width(6.dp));Text("AU Chat")};OutlinedButton(onClick=onNavigateToStudy,shape=RoundedCornerShape(15.dp)){Icon(Icons.Outlined.School,null);Spacer(Modifier.width(6.dp));Text("Study")}}}}
  item{Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){Text("Active Documents",style=MaterialTheme.typography.titleLarge,fontWeight=FontWeight.Bold,color=DataCubeColors.Navy);Spacer(Modifier.weight(1f));TextButton(onClick=onNavigateToDocuments){Text("View All →")}}}
  if(recentDocuments.isEmpty())item{Surface(shape=RoundedCornerShape(20.dp),color=Color.White,border=BorderStroke(1.dp,DataCubeColors.Divider)){Column(Modifier.fillMaxWidth().padding(22.dp),horizontalAlignment=Alignment.CenterHorizontally){Icon(Icons.Outlined.FolderOpen,null,tint=DataCubeColors.Blue,modifier=Modifier.size(42.dp));Text("No documents yet",fontWeight=FontWeight.Bold,color=DataCubeColors.Navy);Text("Upload a file to start exploring your documents.",color=DataCubeColors.TextSecondary);Spacer(Modifier.height(12.dp));Button(onClick=onImportDocument){Icon(Icons.Outlined.Add,null);Text("Upload Documents")}}}}
  else items(recentDocuments.take(5),key={it.document.id}){doc->Surface(shape=RoundedCornerShape(17.dp),color=Color.White,border=BorderStroke(1.dp,DataCubeColors.Divider)){Row(Modifier.fillMaxWidth().padding(13.dp),verticalAlignment=Alignment.CenterVertically){val e=doc.document.extension.lowercase();val c=when(e){"pdf"->Color(0xFFE5484D);"docx"->DataCubeColors.Blue;else->Color(0xFF20A866)};Box(Modifier.size(52.dp).clip(RoundedCornerShape(14.dp)).background(c.copy(alpha=.12f)),contentAlignment=Alignment.Center){Text(e.uppercase().take(3),color=c,fontWeight=FontWeight.Bold)};Spacer(Modifier.width(13.dp));Column(Modifier.weight(1f)){Text(doc.document.name,fontWeight=FontWeight.SemiBold,color=DataCubeColors.Navy,maxLines=1);Text(e.uppercase()+" • "+(doc.document.sizeBytes/1024)+" KB",style=MaterialTheme.typography.bodySmall,color=DataCubeColors.TextSecondary)};Icon(Icons.Outlined.MoreVert,null,tint=DataCubeColors.Navy)}}}
  item{Surface(shape=RoundedCornerShape(20.dp),color=Color.White,border=BorderStroke(1.dp,DataCubeColors.Divider)){Column(Modifier.fillMaxWidth().padding(16.dp)){Row(verticalAlignment=Alignment.CenterVertically){Icon(Icons.Outlined.AutoAwesome,null,tint=DataCubeColors.Blue);Spacer(Modifier.width(8.dp));Text("Ask anything about your documents",fontWeight=FontWeight.SemiBold,color=DataCubeColors.Navy)};Spacer(Modifier.height(10.dp));Text("Open AU Chat to ask questions and explore document insights.",color=DataCubeColors.TextSecondary);Spacer(Modifier.height(12.dp));Button(onClick=onNavigateToChat,modifier=Modifier.fillMaxWidth()){Text("Open AU Chat")}}}}
 }
}
