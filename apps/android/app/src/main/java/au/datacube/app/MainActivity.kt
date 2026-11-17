package au.datacube.app

import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import au.datacube.app.data.LocalDocument
import au.datacube.app.ui.DataCubeViewModel
import au.datacube.app.work.LocalJobScheduler
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val viewModel: DataCubeViewModel by viewModels()
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { DataCubeTheme { DataCubeRoot(viewModel) } }
        lifecycleScope.launch {
            runCatching { LocalJobScheduler(applicationContext).enqueueRecoverable() }
        }
    }
}

private enum class Tab(val title: String) {
    Home("Home"), Documents("Documents"), Study("Study"), Chat("AU Chat"), Profile("Profile")
}

@Composable
private fun DataCubeRoot(viewModel: DataCubeViewModel) {
    var selected by remember { mutableIntStateOf(0) }
    val documents by viewModel.documents.collectAsState()
    val context = LocalContext.current
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val mimeTypes = arrayOf(
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "text/plain", "application/rtf", "text/markdown"
    )
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
        if (uri != null) {
            val name = context.contentResolver.query(
                uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null
            )?.use { cursor ->
                if (cursor.moveToFirst()) cursor.getString(0) else null
            } ?: "Imported document"
            viewModel.import(uri, name) { result ->
                scope.launch {
                    snackbar.showSnackbar(
                        result.exceptionOrNull()?.message ?: "Document saved privately. Local verification has been queued."
                    )
                }
            }
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        bottomBar = {
            NavigationBar {
                Tab.entries.forEachIndexed { index, tab ->
                    val icon = when (tab) {
                        Tab.Home -> Icons.Outlined.Home
                        Tab.Documents -> Icons.Outlined.Folder
                        Tab.Study -> Icons.Outlined.School
                        Tab.Chat -> Icons.Outlined.Chat
                        Tab.Profile -> Icons.Outlined.Person
                    }
                    NavigationBarItem(
                        selected = selected == index,
                        onClick = { selected = index },
                        icon = { Icon(icon, contentDescription = tab.title) },
                        label = { Text(tab.title) }
                    )
                }
            }
        }
    ) { padding ->
        when (Tab.entries[selected]) {
            Tab.Home -> HomeScreen(Modifier.padding(padding)) { picker.launch(mimeTypes) }
            Tab.Documents -> DocumentsScreen(
                Modifier.padding(padding), documents, { picker.launch(mimeTypes) }, viewModel::delete
            )
            Tab.Study -> FeatureScreen(
                Modifier.padding(padding), "Study Space",
                "Smart Notes, practice exams and topic predictions."
            )
            Tab.Chat -> FeatureScreen(
                Modifier.padding(padding), "AU Chat",
                "Ask questions about your materials. Local inference is the default; cloud inference requires explicit permission."
            )
            Tab.Profile -> FeatureScreen(
                Modifier.padding(padding), "Your Profile",
                "Account, subscription, model preferences and privacy controls."
            )
        }
    }
}

@Composable
private fun HomeScreen(modifier: Modifier, onImport: () -> Unit) {
    LazyColumn(modifier.fillMaxSize().padding(20.dp)) {
        item {
            Text("DATACUBE AU", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
            Text("Your learning workspace")
            Spacer(Modifier.height(28.dp))
            Text("Good to have you here.", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
            Text("Your documents, AI tools and study sessions in one place.")
            Spacer(Modifier.height(22.dp))
        }
        item {
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primary)) {
                Column(Modifier.padding(20.dp)) {
                    Icon(Icons.Outlined.AutoAwesome, contentDescription = null, tint = Color.White)
                    Spacer(Modifier.height(12.dp))
                    Text("Learn from your own materials", style = MaterialTheme.typography.titleLarge, color = Color.White, fontWeight = FontWeight.Bold)
                    Text("Import a document to build your private, on-device study workspace.", color = Color.White)
                    Spacer(Modifier.height(14.dp))
                    Button(
                        onClick = onImport,
                        colors = ButtonDefaults.buttonColors(containerColor = Color.White, contentColor = MaterialTheme.colorScheme.primary)
                    ) {
                        Icon(Icons.Outlined.Add, contentDescription = null)
                        Text("Add a document")
                    }
                }
            }
            Spacer(Modifier.height(24.dp))
            Text("Your workspace", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        }
        items(listOf(
            "My Documents" to "Import and organise learning materials",
            "AU Chat" to "Ask questions about your materials",
            "Smart Notes" to "Turn materials into study notes",
            "Practice & Predictions" to "Prepare with focused study tools"
        )) { (title, subtitle) ->
            ListItem(
                headlineContent = { Text(title, fontWeight = FontWeight.SemiBold) },
                supportingContent = { Text(subtitle) },
                trailingContent = { Icon(Icons.Outlined.ChevronRight, contentDescription = null) }
            )
        }
        item {
            Text(
                "Local processing is the foundation. Cloud features remain optional and subject to account limits.",
                style = MaterialTheme.typography.bodySmall
            )
        }
    }
}

@Composable
private fun DocumentsScreen(
    modifier: Modifier,
    documents: List<LocalDocument>,
    onImport: () -> Unit,
    onDelete: (String) -> Unit
) {
    Column(modifier.fillMaxSize().padding(18.dp)) {
        Text("My Documents", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Text("Files are copied into app-private storage. Document content is not uploaded.")
        Spacer(Modifier.height(14.dp))
        Button(onClick = onImport, modifier = Modifier.fillMaxWidth()) {
            Icon(Icons.Outlined.Add, contentDescription = null)
            Text("Import a document")
        }
        if (documents.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(Icons.Outlined.FolderOpen, contentDescription = null, modifier = Modifier.size(44.dp))
                    Text("Your library is empty", fontWeight = FontWeight.Bold)
                    Text("Import PDF, DOCX, TXT, RTF or Markdown.")
                }
            }
        } else {
            LazyColumn {
                items(documents, key = { it.id }) { document ->
                    ListItem(
                        leadingContent = {
                            Icon(
                                if (document.extension == "pdf") Icons.Outlined.PictureAsPdf else Icons.Outlined.Description,
                                contentDescription = null
                            )
                        },
                        headlineContent = { Text(document.name, maxLines = 2) },
                        supportingContent = {
                            Text("${document.extension.uppercase()} • ${document.sizeBytes / 1024} KB • ${if (document.sha256 == null) "Verifying locally" else "Verified locally"}")
                        },
                        trailingContent = {
                            IconButton(onClick = { onDelete(document.id) }) {
                                Icon(Icons.Outlined.DeleteOutline, contentDescription = "Delete")
                            }
                        }
                    )
                    HorizontalDivider()
                }
            }
        }
    }
}

@Composable
private fun FeatureScreen(modifier: Modifier, title: String, description: String) {
    Box(modifier.fillMaxSize().padding(28.dp), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(8.dp))
            Text(description)
            Spacer(Modifier.height(14.dp))
            Text("Feature migration in progress", fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
private fun DataCubeTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = lightColorScheme(
            primary = Color(0xFF2183E3),
            onPrimary = Color.White,
            background = Color(0xFFF7F9FC),
            surface = Color.White
        ),
        content = content
    )
}
