package au.datacube.app

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.core.tween
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import au.datacube.app.ui.DataCubeViewModel
import au.datacube.app.ui.auth.AuthScreen
import au.datacube.app.ui.auth.AuthViewModel
import au.datacube.app.ui.chat.ChatScreen
import au.datacube.app.ui.documents.DocumentsScreen
import au.datacube.app.ui.documents.CollectionWorkspaceScreen
import au.datacube.app.ui.documents.DocumentWorkspaceScreen
import au.datacube.app.data.LocalDocument
import au.datacube.app.models.ModelBackupManager
import au.datacube.app.models.ModelBackupProgress
import au.datacube.app.models.ModelRegistry
import au.datacube.app.models.InstalledModelRecord
import au.datacube.app.ui.home.HomeScreen
import au.datacube.app.ui.profile.ProfileScreen
import au.datacube.app.ui.study.StudyScreen
import au.datacube.app.ui.theme.DataCubeTheme
import au.datacube.app.work.LocalJobScheduler
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : ComponentActivity() {

    private val authViewModel: AuthViewModel by viewModels()
    private val documentsViewModel: DataCubeViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)

        // Recover any locally interrupted jobs on startup.
        lifecycleScope.launch {
            runCatching { LocalJobScheduler(applicationContext).enqueueRecoverable() }
        }

        setContent {
            DataCubeTheme {
                DataCubeRoot(authViewModel, documentsViewModel)
            }
        }
        handleAuthIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleAuthIntent(intent)
    }

    private fun handleAuthIntent(incoming: Intent?) {
        val uri = incoming?.data ?: return
        if (incoming.action != Intent.ACTION_VIEW ||
            uri.scheme != "datacube" ||
            uri.host != "auth-callback"
        ) return

        val code = uri.getQueryParameter("code")
        val state = uri.getQueryParameter("state")
        // Consume the launch URI so Activity recreation cannot replay the handoff.
        setIntent(Intent(incoming).apply { data = null })
        authViewModel.completeWebsiteAuthentication(code, state)
    }

}

// ── Navigation destinations ───────────────────────────────────────────────────

private sealed class Screen(val route: String) {
    object Auth : Screen("auth")
    object Home : Screen("home")
    object Documents : Screen("documents")
    object Collection : Screen("collection/{id}")
    object Document : Screen("document/{id}?prompt={prompt}&tab={tab}")
    object Study : Screen("study")
    object Chat : Screen("chat")
    object Profile : Screen("profile")
}

private data class BottomNavItem(
    val screen: Screen,
    val label: String,
    val icon: androidx.compose.ui.graphics.vector.ImageVector
)

private val bottomNavItems = listOf(
    BottomNavItem(Screen.Home, "Home", Icons.Outlined.Home),
    BottomNavItem(Screen.Documents, "Documents", Icons.Outlined.Folder),
    BottomNavItem(Screen.Study, "Study", Icons.Outlined.School),
    BottomNavItem(Screen.Chat, "AU Chat", Icons.Outlined.Chat),
    BottomNavItem(Screen.Profile, "Profile", Icons.Outlined.Person)
)

// ── Root composable ───────────────────────────────────────────────────────────

@Composable
private fun DataCubeRoot(
    authViewModel: AuthViewModel,
    documentsViewModel: DataCubeViewModel
) {
    val authState by authViewModel.state.collectAsStateWithLifecycle()
    val documents by documentsViewModel.documents.collectAsStateWithLifecycle()
    val collections by documentsViewModel.collections.collectAsStateWithLifecycle()
    val navController = rememberNavController()
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var collectionPickerTarget by remember { mutableStateOf<String?>(null) }
    var modelOperationJob by remember { mutableStateOf<Job?>(null) }
    var modelOperationBusy by remember { mutableStateOf(false) }
    var modelBackupProgress by remember { mutableStateOf<ModelBackupProgress?>(null) }
    var installedModels by remember { mutableStateOf<List<InstalledModelRecord>>(emptyList()) }
    var modelInventoryRevision by remember { mutableStateOf(0) }

    // Multi-select document picker. Imports are copied sequentially and scheduled locally.
    val mimeTypes = arrayOf(
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "text/plain", "application/rtf", "text/markdown"
    )

    val modelBackupLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument(ModelBackupManager.BACKUP_MIME_TYPE)
    ) { destination ->
        if (destination != null && !modelOperationBusy) {
            modelOperationBusy = true
            modelBackupProgress = ModelBackupProgress(phase = "Starting model backup")
            modelOperationJob = scope.launch {
                try {
                    val summary = ModelBackupManager(context).exportBackup(destination) { progress ->
                        scope.launch { modelBackupProgress = progress }
                    }
                    snackbar.showSnackbar(
                        "Backed up ${summary.modelCount} model(s), ${summary.fileCount} file(s)."
                    )
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (error: Exception) {
                    snackbar.showSnackbar(error.message ?: "Could not create the model backup.")
                } finally {
                    modelOperationJob = null
                    modelOperationBusy = false
                    modelBackupProgress = null
                }
            }
        }
    }

    val modelRestoreLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { source ->
        if (source != null && !modelOperationBusy) {
            modelOperationBusy = true
            modelBackupProgress = ModelBackupProgress(phase = "Starting model restore")
            modelOperationJob = scope.launch {
                try {
                    val summary = ModelBackupManager(context).restoreBackup(source) { progress ->
                        scope.launch { modelBackupProgress = progress }
                    }
                    modelInventoryRevision += 1
                    snackbar.showSnackbar(
                        "Restored ${summary.modelCount} model(s), ${summary.fileCount} file(s)."
                    )
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (error: Exception) {
                    snackbar.showSnackbar(error.message ?: "Could not restore the model backup.")
                } finally {
                    modelOperationJob = null
                    modelOperationBusy = false
                    modelBackupProgress = null
                }
            }
        }
    }

    val multiPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        val targetCollection = collectionPickerTarget
        collectionPickerTarget = null
        if (uris.isNotEmpty()) {
            if (targetCollection != null) {
                documentsViewModel.importManyToCollection(uris, targetCollection) { result ->
                    scope.launch {
                        result.onSuccess { count ->
                            snackbar.showSnackbar("$count document(s) added to collection.")
                        }.onFailure { error ->
                            snackbar.showSnackbar(error.message ?: "Could not finish importing documents.")
                        }
                    }
                }
            } else {
                documentsViewModel.importMany(uris) { result ->
                    scope.launch {
                        result.onSuccess { count ->
                            snackbar.showSnackbar("$count document(s) imported. Local processing has been queued.")
                        }.onFailure { error ->
                            snackbar.showSnackbar(error.message ?: "Could not import the selected documents.")
                        }
                    }
                }
            }
        }
    }

    // Loading / session-restore gate
    if (!authState.sessionRestored) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator()
        }
        return
    }

    // If not authenticated, show auth screen
    if (authState.user == null) {
        AuthScreen(
            viewModel = authViewModel,
            onOpenWebsite = { url ->
                context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
            }
        )
        return
    }

    val navBackStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = navBackStackEntry?.destination?.route
    LaunchedEffect(currentRoute, modelInventoryRevision) {
        if (currentRoute == Screen.Profile.route) {
            installedModels = withContext(Dispatchers.IO) {
                ModelRegistry(context).listInstalled()
            }
        }
    }
    val isWorkspaceRoute = currentRoute == Screen.Collection.route || currentRoute == Screen.Document.route

    // Nested workspaces consume system back and return to their parent instead of closing the app.
    BackHandler(enabled = isWorkspaceRoute && navController.previousBackStackEntry != null) {
        navController.popBackStack()
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        bottomBar = {
            if (!isWorkspaceRoute) {
                val current = navBackStackEntry?.destination
                NavigationBar {
                    bottomNavItems.forEach { item ->
                        NavigationBarItem(
                            selected = current?.hierarchy?.any { it.route == item.screen.route } == true,
                            onClick = {
                                navController.navigate(item.screen.route) {
                                    popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                                    launchSingleTop = true
                                    restoreState = true
                                }
                            },
                            icon = { Icon(item.icon, contentDescription = item.label) },
                            label = { Text(item.label) }
                        )
                    }
                }
            }
        }
    ) { padding ->
        NavHost(
            navController = navController,
            startDestination = Screen.Home.route,
            modifier = Modifier.padding(padding),
            enterTransition = { fadeIn(tween(170)) + slideInHorizontally(tween(170)) { it / 18 } },
            exitTransition = { fadeOut(tween(130)) + slideOutHorizontally(tween(130)) { -it / 24 } },
            popEnterTransition = { fadeIn(tween(170)) + slideInHorizontally(tween(170)) { -it / 24 } },
            popExitTransition = { fadeOut(tween(130)) + slideOutHorizontally(tween(130)) { it / 24 } }
        ) {
            composable(Screen.Home.route) {
                HomeScreen(
                    user = authState.user,
                    recentDocuments = documents,
                    onImportDocument = { multiPicker.launch(mimeTypes) },
                    onNavigateToDocuments = { navController.navigate(Screen.Documents.route) },
                    onNavigateToStudy = { navController.navigate(Screen.Study.route) },
                    onNavigateToChat = { navController.navigate(Screen.Chat.route) },
                    onOpenDocument = { id -> navController.navigate("document/$id") },
                    onSendPromptToDocument = { id, prompt ->
                        navController.navigate("document/$id?prompt=" + Uri.encode(prompt) + "&tab=0")
                    },
                    onNavigateSettings = { navController.navigate(Screen.Profile.route) }
                )
            }
            composable(Screen.Documents.route) {
                DocumentsScreen(
                    documents = documents,
                    collections = collections,
                    onImport = { multiPicker.launch(mimeTypes) },
                    onNavigateHome = { navController.navigate(Screen.Home.route) },
                    onNavigateSettings = { navController.navigate(Screen.Profile.route) },
                    onCreateCollection = { name, done -> documentsViewModel.createCollection(name, done = done) },
                    onOpenCollection = { id -> navController.navigate("collection/$id") },
                    onDeleteCollection = documentsViewModel::deleteCollection,
                    onOpenDocument = { id -> navController.navigate("document/$id") },
                    onDelete = documentsViewModel::delete
                )
            }
            composable(Screen.Collection.route) { entry ->
                val collectionId = entry.arguments?.getString("id").orEmpty()
                val collection = collections.firstOrNull { it.id == collectionId }
                val collectionDocumentsFlow = remember(collectionId) {
                    documentsViewModel.observeCollectionDocuments(collectionId)
                }
                val collectionDocuments by collectionDocumentsFlow.collectAsStateWithLifecycle(initialValue = emptyList())
                CollectionWorkspaceScreen(
                    name = collection?.name ?: "Collection",
                    documents = collectionDocuments,
                    onBack = { navController.popBackStack() },
                    onAddDocuments = {
                        collectionPickerTarget = collectionId
                        multiPicker.launch(mimeTypes)
                    },
                    onRemoveDocument = { id ->
                        documentsViewModel.removeDocumentFromCollection(collectionId, id)
                    },
                    onOpenDocument = { id -> navController.navigate("document/$id") }
                )
            }
            composable(
                Screen.Document.route,
                arguments = listOf(
                    androidx.navigation.navArgument("prompt") {
                        type = androidx.navigation.NavType.StringType
                        defaultValue = ""
                    },
                    androidx.navigation.navArgument("tab") {
                        type = androidx.navigation.NavType.IntType
                        defaultValue = 0
                    }
                )
            ) { entry ->
                val documentId = entry.arguments?.getString("id").orEmpty()
                val initialPrompt = entry.arguments?.getString("prompt")
                val initialTab = entry.arguments?.getInt("tab") ?: 0
                val selectedProcessing = documents.firstOrNull { it.document.id == documentId }
                val selectedDocument = selectedProcessing?.document
                var textPreview by remember(documentId) { mutableStateOf<String?>(null) }
                var previewTruncated by remember(documentId) { mutableStateOf(false) }
                var previewLoading by remember(documentId) { mutableStateOf(true) }
                var previewError by remember(documentId) { mutableStateOf<String?>(null) }

                LaunchedEffect(documentId, selectedProcessing?.extractionStatus) {
                    previewLoading = true
                    previewError = null
                    textPreview = null
                    try {
                        val preview = documentsViewModel.loadDocumentTextPreview(documentId)
                        textPreview = preview?.text
                        previewTruncated = preview?.truncated == true
                    } catch (error: Exception) {
                        previewError = error.message ?: "The local document preview could not be loaded."
                    } finally {
                        previewLoading = false
                    }
                }

                if (selectedDocument != null) {
                    DocumentWorkspaceScreen(
                        document = selectedDocument,
                        initialPrompt = initialPrompt,
                        initialTab = initialTab,
                        extractionStatus = selectedProcessing?.extractionStatus,
                        extractionProgress = selectedProcessing?.extractionProgress,
                        extractionError = selectedProcessing?.extractionError,
                        textPreview = textPreview,
                        previewTruncated = previewTruncated,
                        previewLoading = previewLoading,
                        previewError = previewError,
                        onBack = { navController.popBackStack() }
                    )
                } else {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Text("Document is unavailable. Return to your library and refresh.")
                    }
                }
            }
            composable(Screen.Study.route) {
                StudyScreen(
                    documents = documents,
                    onOpenDocument = { id, tab -> navController.navigate("document/$id?prompt=&tab=$tab") },
                    onImport = { multiPicker.launch(mimeTypes) }
                )
            }
            composable(Screen.Chat.route) {
                ChatScreen(
                    documents = documents,
                    onOpenDocument = { id -> navController.navigate("document/$id?prompt=&tab=0") },
                    onImport = { multiPicker.launch(mimeTypes) }
                )
            }
            composable(Screen.Profile.route) {
                ProfileScreen(
                    user = authState.user,
                    modelOperationBusy = modelOperationBusy,
                    modelBackupProgress = modelBackupProgress,
                    installedModels = installedModels,
                    onCancelModelOperation = { modelOperationJob?.cancel() },
                    onSignOut = { authViewModel.signOut() },
                    onBackupModels = {
                        modelBackupLauncher.launch(
                            "${ModelBackupManager.BACKUP_FILE_PREFIX}-${System.currentTimeMillis()}.zip"
                        )
                    },
                    onRestoreModels = {
                        modelRestoreLauncher.launch(arrayOf(ModelBackupManager.BACKUP_MIME_TYPE))
                    }
                )
            }
        }
    }
}
