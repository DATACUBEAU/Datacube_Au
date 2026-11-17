package au.datacube.app
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import au.datacube.app.data.LocalDocument
import au.datacube.app.ui.DataCubeViewModel

class MainActivity : ComponentActivity() {
 private val vm: DataCubeViewModel by viewModels()
 override fun onCreate(savedInstanceState: Bundle?) { super.onCreate(savedInstanceState); setContent { DataCubeTheme { DataCubeRoot(vm) } } }
}
private enum class Tab(val title: String) { Home("Home"), Documents("Documents"), Study("Study"), Chat("AU Chat"), Profile("Profile") }
@Composable private fun DataCubeRoot(vm: DataCubeViewModel) {
 var selected by remember { mutableIntStateOf(0) }
 var message by remember { mutableStateOf<String?>(null) }
 val docs by vm.documents.collectAsState()
 val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
  if (uri != null) vm.import(uri, uri.lastPathSegment?.substringAfterLast(':') ?: "Imported document") { result -> message = result.exceptionOrNull()?.message ?: "Document saved privately on this device." }
 }
 Scaffold(bottomBar = { NavigationBar { Tab.entries.forEachIndexed { i,t ->
  val icon = when(t) { Tab.Home->Icons.Outlined.Home; Tab.Documents->Icons.Outlined.Folder; Tab.Study->Icons.Outlined.School; Tab.Chat->Icons.Outlined.Chat; Tab.Profile->Icons.Outlined.Person }
  NavigationBarItem(selected==i,{selected=i},{Icon(icon,t.title)},label={Text(t.title)})
 } } }) { pad ->
  when(Tab.entries[selected]) {
   Tab.Home -> HomeScreen(Modifier.padding(pad)) { picker.launch(arrayOf("application/pdf","application/vnd.openxmlformats-officedocument.wordprocessingml.document","text/plain","application/rtf","text/markdown")) }
   Tab.Documents -> DocumentsScreen(Modifier.padding(pad),docs,{picker.launch(arrayOf("application/pdf","application/vnd.openxmlformats-officedocument.wordprocessingml.document","text/plain","application/rtf","text/markdown"))},vm::delete)
   Tab.Study -> FeatureScreen(Modifier.padding(pad),"Study Space","Smart Notes, practice exams and topic predictions.")
   Tab.Chat -> FeatureScreen(Modifier.padding(pad),"AU Chat","Ask questions about your materials. Local inference is the default; cloud inference requires explicit permission.")
   Tab.Profile -> FeatureScreen(Modifier.padding(pad),"Your Profile","Account, subscription, model preferences and privacy controls.")
  }
 }
 message?.let { text -> LaunchedEffect(text) { /* Surface transient result without exposing document content. */ }; SnackbarHost(remember { SnackbarHostState() }); }
}
@Composable private fun HomeScreen(modifier: Modifier,onImport:()->Unit) {
 LazyColumn(modifier.fillMaxSize().padding(20.dp)) {
  item { Text("DATACUBE AU",style=MaterialTheme.typography.labelLarge,fontWeight=FontWeight.Bold); Text("Your learning workspace") }
  item { Spacer(Modifier.height(28.dp)); Text("Good to have you here.",style=MaterialTheme.typography.headlineMedium,fontWeight=FontWeight.Bold); Text("Your documents, AI tools and study sessions in one place.") }
  item { Spacer(Modifier.height(22.dp)); Card(colors=CardDefaults.cardColors(containerColor=MaterialTheme.colorScheme.primary)) { Column(Modifier.padding(20.dp)) {
   Icon(Icons.Outlined.AutoAwesome,null,tint=Color.White); Spacer(Modifier.height(12.dp)); Text("Learn from your own materials",style=MaterialTheme.typography.titleLarge,color=Color.White,fontWeight=FontWeight.Bold)
   Text("Import a document to build your private, on-device study workspace.",color=Color.White); Spacer(Modifier.height(14.dp))
   Button(onImport,colors=ButtonDefaults.buttonColors(containerColor=Color.White,contentColor=MaterialTheme.colorScheme.primary)) { Icon(Icons.Outlined.Add,null); Text("Add a document") }
  } } }
  item { Spacer(Modifier.height(24.dp)); Text("Your workspace",style=MaterialTheme.typography.titleLarge,fontWeight=FontWeight.Bold) }
  items(listOf("My Documents" to "Import and organise learning materials","AU Chat" to "Ask questions about your materials","Smart Notes" to "Turn materials into study notes","Practice & Predictions" to "Prepare with focused study tools")) { (title,sub) -> ListItem(headlineContent={Text(title,fontWeight=FontWeight.SemiBold)},supportingContent={Text(sub)},trailingContent={Icon(Icons.Outlined.ChevronRight,null)}) }
  item { Text("Local processing is the foundation. Cloud features remain optional and subject to account limits.",style=MaterialTheme.typography.bodySmall) }
 }
}
@Composable private fun DocumentsScreen(modifier: Modifier,docs:List<LocalDocument>,onImport:()->Unit,onDelete:(String)->Unit) {
 Column(modifier.fillMaxSize().padding(18.dp)) {
  Text("My Documents",style=MaterialTheme.typography.headlineSmall,fontWeight=FontWeight.Bold)
  Text("Files are copied into app-private storage. Document content is not uploaded.")
  Spacer(Modifier.height(14.dp)); Button(onImport,modifier.fillMaxWidth()) { Icon(Icons.Outlined.Add,null); Text("Import a document") }
  if(docs.isEmpty()) Box(Modifier.fillMaxSize(),contentAlignment=Alignment.Center) { Column(horizontalAlignment=Alignment.CenterHorizontally) { Icon(Icons.Outlined.FolderOpen,null,Modifier.size(44.dp)); Text("Your library is empty",fontWeight=FontWeight.Bold); Text("Import PDF, DOCX, TXT, RTF or Markdown.") } }
  else LazyColumn { items(docs,key={it.id}) { d -> ListItem(leadingContent={Icon(if(d.extension=="pdf") Icons.Outlined.PictureAsPdf else Icons.Outlined.Description,null)},headlineContent={Text(d.name,maxLines=2)},supportingContent={Text("${d.extension.uppercase()} • ${d.sizeBytes/1024} KB • Stored on device")},trailingContent={IconButton({onDelete(d.id)}) { Icon(Icons.Outlined.DeleteOutline,"Delete") }}); HorizontalDivider() } }
 }
}
@Composable private fun FeatureScreen(modifier:Modifier,title:String,description:String) { Box(modifier.fillMaxSize().padding(28.dp),contentAlignment=Alignment.Center) { Column(horizontalAlignment=Alignment.CenterHorizontally) { Text(title,style=MaterialTheme.typography.headlineSmall,fontWeight=FontWeight.Bold); Spacer(Modifier.height(8.dp)); Text(description); Spacer(Modifier.height(14.dp)); Text("Feature migration in progress",fontWeight=FontWeight.SemiBold) } } }
@Composable private fun DataCubeTheme(content:@Composable ()->Unit) { MaterialTheme(colorScheme=lightColorScheme(primary=Color(0xFF2183E3),onPrimary=Color.White,background=Color(0xFFF7F9FC),surface=Color.White),content=content) }
