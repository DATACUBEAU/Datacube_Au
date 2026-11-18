package au.datacube.app.ui.documents
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import au.datacube.app.data.LocalDocumentProcessing
import au.datacube.app.data.LocalJobStatus
import au.datacube.app.ui.theme.DataCubeColors
@Composable fun DocumentsScreen(modifier:Modifier=Modifier,documents:List<LocalDocumentProcessing>,onImport:()->Unit,onDelete:(String)->Unit){
 var deleteTarget by remember{mutableStateOf<String?>(null)}
 deleteTarget?.let{id->AlertDialog(onDismissRequest={deleteTarget=null},title={Text("Remove document?")},text={Text("The document and extracted text will be deleted from this device.")},confirmButton={TextButton(onClick={onDelete(id);deleteTarget=null}){Text("Delete")}},dismissButton={TextButton(onClick={deleteTarget=null}){Text("Cancel")}})}
 Column(modifier.fillMaxSize().background(DataCubeColors.BluePale)){
  androidx.compose.foundation.lazy.LazyColumn(contentPadding=PaddingValues(18.dp),verticalArrangement=Arrangement.spacedBy(18.dp)){
   item{Column{Text("Documents",style=MaterialTheme.typography.headlineLarge,fontWeight=FontWeight.Bold,color=DataCubeColors.Navy);Spacer(Modifier.height(5.dp));Text("Upload files or create collections to organize your documents.",color=DataCubeColors.TextSecondary,style=MaterialTheme.typography.bodyLarge)}}
   item{Button(onClick=onImport,modifier=Modifier.fillMaxWidth().height(76.dp),shape=RoundedCornerShape(18.dp)){Icon(Icons.Outlined.AddCircle,null,modifier=Modifier.size(28.dp));Spacer(Modifier.width(12.dp));Column{Text("Upload Documents",fontWeight=FontWeight.Bold);Text("Add one or multiple files",style=MaterialTheme.typography.bodySmall)}}}
   item{Column{Row(verticalAlignment=Alignment.CenterVertically){Text("Collections",style=MaterialTheme.typography.titleLarge,fontWeight=FontWeight.Bold,color=DataCubeColors.Navy);Spacer(Modifier.weight(1f));Text("View All →",color=DataCubeColors.Blue)};Spacer(Modifier.height(9.dp));Surface(shape=RoundedCornerShape(19.dp),color=Color.White,border=BorderStroke(1.dp,DataCubeColors.Divider)){Column(Modifier.fillMaxWidth().padding(20.dp),horizontalAlignment=Alignment.CenterHorizontally){Icon(Icons.Outlined.FolderOpen,null,tint=DataCubeColors.Blue,modifier=Modifier.size(40.dp));Text("No collections yet",fontWeight=FontWeight.Bold,color=DataCubeColors.Navy);Text("Collection creation is not connected yet.",color=DataCubeColors.TextSecondary)}}}}
   item{Row(verticalAlignment=Alignment.CenterVertically){Text("Recent Documents",style=MaterialTheme.typography.titleLarge,fontWeight=FontWeight.Bold,color=DataCubeColors.Navy);Spacer(Modifier.weight(1f));Text(documents.size.toString()+" files",color=DataCubeColors.TextSecondary)}}
   if(documents.isEmpty())item{Surface(shape=RoundedCornerShape(18.dp),color=Color.White,border=BorderStroke(1.dp,DataCubeColors.Divider)){Column(Modifier.fillMaxWidth().padding(22.dp),horizontalAlignment=Alignment.CenterHorizontally){Text("Your documents will appear here",color=DataCubeColors.TextSecondary);Button(onClick=onImport){Text("Upload a document")}}}}
   else item{Surface(shape=RoundedCornerShape(19.dp),color=Color.White,border=BorderStroke(1.dp,DataCubeColors.Divider)){Column{documents.forEachIndexed{index,item->val d=item.document;val status=when(item.extractionStatus){LocalJobStatus.QUEUED,LocalJobStatus.RETRYABLE->"Processing queued";LocalJobStatus.RUNNING->"Processing…";LocalJobStatus.COMPLETED->"Ready";LocalJobStatus.FAILED->item.extractionError?:"Processing failed";LocalJobStatus.CANCELLED->"Cancelled";else->"Imported"};Row(Modifier.fillMaxWidth().padding(12.dp),verticalAlignment=Alignment.CenterVertically){val ext=d.extension.lowercase();val tint=when(ext){"pdf"->Color(0xFFE5484D);"docx"->DataCubeColors.Blue;else->Color(0xFF20A866)};Box(Modifier.size(48.dp).background(tint.copy(alpha=.12f),RoundedCornerShape(13.dp)),contentAlignment=Alignment.Center){Text(ext.uppercase().take(3),color=tint,fontWeight=FontWeight.Bold)};Spacer(Modifier.width(12.dp));Column(Modifier.weight(1f)){Text(d.name,fontWeight=FontWeight.SemiBold,color=DataCubeColors.Navy,maxLines=1);Text(status+" • "+(d.sizeBytes/1024)+" KB",style=MaterialTheme.typography.bodySmall,color=DataCubeColors.TextSecondary)};IconButton(onClick={deleteTarget=d.id}){Icon(Icons.Outlined.MoreVert,"Document actions")}};if(index!=documents.lastIndex)HorizontalDivider(color=DataCubeColors.Divider)}}}}
  }
 }
}
