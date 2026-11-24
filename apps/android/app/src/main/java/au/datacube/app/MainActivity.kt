package au.datacube.app

import au.datacube.app.ui.common.DataCubeDialog
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.core.tween
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.activity.compose.ReportDrawnWhen
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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.doOnPreDraw
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import au.datacube.app.ui.DataCubeViewModel
import au.datacube.app.ui.auth.AuthScreen
import au.datacube.app.ui.auth.AuthViewModel
import au.datacube.app.ui.documents.DocumentsScreen
import au.datacube.app.ui.documents.CollectionWorkspaceScreen
import au.datacube.app.ui.documents.DocumentWorkspaceScreen
import au.datacube.app.ui.documents.DocumentChatSessions
import au.datacube.app.ui.chat.DiscsScreen
import au.datacube.app.data.LocalDocument
import au.datacube.app.data.LocalJobStatus
import au.datacube.app.ui.documents.DocumentPreparationScreen
import au.datacube.app.models.ModelBackupManager
import au.datacube.app.models.ModelBackupPreview
import au.datacube.app.models.ModelVaultStore
import au.datacube.app.ui.models.ModelVaultScreen
import au.datacube.app.models.LocalModelLibrary
import au.datacube.app.models.ModelCatalog
import au.datacube.app.models.ModelSpec
import au.datacube.app.models.DeviceCapabilityScanner
import au.datacube.app.ui.models.ModelsScreen
import au.datacube.app.ui.theme.ThemePreference
import au.datacube.app.ui.theme.ThemePreferenceStore
import au.datacube.app.ui.home.HomeScreen
import au.datacube.app.updates.AndroidUpdateCheckWorker
import au.datacube.app.updates.AndroidUpdateManager
import au.datacube.app.ui.profile.ProfileScreen
import au.datacube.app.ui.theme.DataCubeTheme
import au.datacube.app.work.LocalJobScheduler
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {

    private val authViewModel: AuthViewModel by viewModels()
    private val documentsViewModel: DataCubeViewModel by viewModels()
    private var mobileSignInRequest: String? = null
    private var ignoreViewIntentOnResume = false
    private var workspaceRecoveryStarted = false

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        // Metadata-only periodic checks; no APK/model is downloaded until user consent.
        AndroidUpdateCheckWorker.schedule(applicationContext)
        val updateJustCompleted = AndroidUpdateManager.consumeUpdatedOnLaunch(applicationContext)
        receiveMobileSignInIntent(intent, "cold")

        setContent {
            val themeStore = remember { ThemePreferenceStore(applicationContext) }
            var displayMode by remember { mutableStateOf(themeStore.get()) }
            val systemDark = isSystemInDarkTheme()
            val dark = when (displayMode) {
                ThemePreference.DARK -> true
                ThemePreference.LIGHT -> false
                ThemePreference.SYSTEM -> systemDark
            }
            DataCubeTheme(darkTheme = dark) {
                DataCubeRoot(
                    authViewModel,
                    { documentsViewModel },
                    openBrowser = ::openBrowser,
                    onWorkspaceDrawn = ::recoverWorkspaceJobs,
                    updateJustCompleted = updateJustCompleted,
                    themePreference = displayMode,
                    onThemeChange = { selected ->
                        themeStore.set(selected)
                        displayMode = selected
                    }
                )
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        receiveMobileSignInIntent(intent, "warm")
    }

    override fun onResume() {
        super.onResume()
        val request = mobileSignInRequest
        val ignoreIntent = ignoreViewIntentOnResume
        mobileSignInRequest = null
        ignoreViewIntentOnResume = false
        if (!ignoreIntent) authViewModel.resumeMobileSignIn(request)
    }

    override fun onPause() {
        authViewModel.pauseMobileSignIn()
        super.onPause()
    }

    private fun receiveMobileSignInIntent(intent: Intent?, launch: String) {
        if (intent?.action != Intent.ACTION_VIEW) {
            ignoreViewIntentOnResume = false
            return
        }
        val request = mobileSignInRequestId(intent)
        if (request == null) {
            ignoreViewIntentOnResume = mobileSignInRequest == null
            Log.i(TAG, "mobile_return_ignored launch=$launch")
            return
        }
        mobileSignInRequest = request
        ignoreViewIntentOnResume = false
        Log.i(TAG, "mobile_return_received launch=$launch")
    }

    private fun openBrowser(uri: Uri) {
        startActivity(Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE))
    }

    private fun recoverWorkspaceJobs() {
        if (workspaceRecoveryStarted) return
        workspaceRecoveryStarted = true
        lifecycleScope.launch(Dispatchers.IO) {
            try {
                LocalJobScheduler(applicationContext).enqueueRecoverable()
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                Log.w(TAG, "local_job_recovery_failed")
            }
        }
    }

    private companion object {
        const val TAG = "DataCubeStartup"
    }
}

// ── Navigation destinations ───────────────────────────────────────────────────

private sealed class Screen(val route: String) {
    object Auth : Screen("auth")
    object Home : Screen("home")
    object Documents : Screen("documents")
    object Discs : Screen("discs")
    object Collection : Screen("collection/{id}")
    object CollectionChat : Screen("collection-chat/{id}")
    object Document : Screen("document/{id}?prompt={prompt}&tab={tab}")
    object Settings : Screen("settings")
    object Models : Screen("models")
    object ModelVault : Screen("model-vault")
}

// ── Root composable ───────────────────────────────────────────────────────────

@Composable
internal fun DataCubeRoot(
    authViewModel: AuthViewModel,
    documentsViewModel: () -> DataCubeViewModel,
    openBrowser: (Uri) -> Unit = {},
    onWorkspaceDrawn: () -> Unit = {},
    updateJustCompleted: Boolean = false,
    themePreference: ThemePreference = ThemePreference.SYSTEM,
    onThemeChange: (ThemePreference) -> Unit = {}
) {
    val authState by authViewModel.state.collectAsStateWithLifecycle()
    ReportDrawnWhen { authState.sessionRestored && !authState.isLoading }

    // Never flash Welcome while an existing encrypted session is still loading.
    if (!authState.sessionRestored) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator()
        }
        return
    }
    if (authState.user == null) {
        AuthScreen(
            viewModel = authViewModel,
            openBrowser = openBrowser
        )
        return
    }

    key(authState.user?.id) {
        AuthenticatedWorkspace(
            authState, authViewModel, documentsViewModel(),
            themePreference, onThemeChange, updateJustCompleted
        )
        val view = LocalView.current
        DisposableEffect(view) {
            val listener = view.doOnPreDraw { view.post { onWorkspaceDrawn() } }
            onDispose { listener.removeListener() }
        }
    }
}

@Composable
private fun AuthenticatedWorkspace(
    authState: au.datacube.app.ui.auth.AuthState,
    authViewModel: AuthViewModel,
    documentsViewModel: DataCubeViewModel,
    themePreference: ThemePreference,
    onThemeChange: (ThemePreference) -> Unit,
    updateJustCompleted: Boolean
) {
    val documents by documentsViewModel.documents.collectAsStateWithLifecycle()
    val collections by documentsViewModel.collections.collectAsStateWithLifecycle()
    val navController = rememberNavController()
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    LaunchedEffect(authState.error) { authState.error?.let { snackbar.showSnackbar(it) } }
    LaunchedEffect(updateJustCompleted) {
        if (updateJustCompleted) {
            snackbar.showSnackbar("DataCube AU updated successfully. Your local data is retained.")
        }
    }
    var collectionPickerTarget by remember { mutableStateOf<String?>(null) }
    var modelRevision by remember { mutableIntStateOf(0) }
    var modelImportTarget by remember { mutableStateOf<ModelSpec?>(null) }
    var vaultRevision by remember { mutableIntStateOf(0) }
    var selectedRestoreUri by remember { mutableStateOf<Uri?>(null) }
    var selectedRestorePreview by remember { mutableStateOf<ModelBackupPreview?>(null) }
    var restoringModels by remember { mutableStateOf(false) }
    var restorePercent by remember { mutableIntStateOf(0) }
    val vaultStore = remember(context) { ModelVaultStore(context.applicationContext) }
    fun offerRestore(uri: Uri) {
        if (restoringModels) return
        scope.launch {
            runCatching { ModelBackupManager(context).inspectBackup(uri) }
                .onSuccess { preview ->
                    selectedRestoreUri = uri
                    selectedRestorePreview = preview
                }
                .onFailure { error ->
                    snackbar.showSnackbar(error.message ?: "Unrecognized model archive.")
                }
        }
    }
    if (selectedRestoreUri != null && selectedRestorePreview != null) {
        val archiveUri = requireNotNull(selectedRestoreUri)
        val preview = requireNotNull(selectedRestorePreview)
        DataCubeDialog(
            onDismissRequest = {
                if (!restoringModels) {
                    selectedRestoreUri = null
                    selectedRestorePreview = null
                }
            },
            title = { Text(if (restoringModels) "Restoring models" else "Smart Recovery") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
                    Text(preview.labels.joinToString("\n"))
                    Text("${preview.fileCount} files · ${preview.totalBytes / (1024 * 1024)} MB")
                    Text("Files will be checked before installation. Existing models will not be replaced.")
                    if (restoringModels) {
                        LinearProgressIndicator(progress = { restorePercent / 100f }, modifier = Modifier.fillMaxWidth())
                        Text("Verifying and restoring · $restorePercent%")
                    }
                }
            },
            confirmButton = {
                TextButton(enabled = !restoringModels, onClick = {
                    restoringModels = true
                    restorePercent = 0
                    scope.launch {
                        val message = try {
                            val summary = ModelBackupManager(context).restoreBackup(archiveUri) { copied, total ->
                                kotlinx.coroutines.withContext(Dispatchers.Main) {
                                    restorePercent = if (total > 0) (copied * 100 / total).toInt().coerceIn(0, 99) else 0
                                }
                            }
                            modelRevision += 1
                            "Restored ${summary.modelCount} model(s) with verified files."
                        } catch (cancelled: CancellationException) {
                            throw cancelled
                        } catch (error: Exception) {
                            error.message ?: "Could not restore the archive."
                        } finally {
                            restoringModels = false
                            selectedRestoreUri = null
                            selectedRestorePreview = null
                        }
                        snackbar.showSnackbar(message)
                    }
                }) { Text("Restore") }
            },
            dismissButton = {
                TextButton(enabled = !restoringModels, onClick = {
                    selectedRestoreUri = null
                    selectedRestorePreview = null
                }) { Text("Cancel") }
            }
        )
    }
    val modelVaultFolderPicker = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocumentTree()
    ) { uri ->
        if (uri != null) {
            runCatching { vaultStore.selectFolder(uri) }
                .onSuccess { vaultRevision += 1 }
                .onFailure { error ->
                    scope.launch { snackbar.showSnackbar(error.message ?: "Cannot use this folder.") }
                }
        }
    }
    val modelStore = remember(context) { LocalModelLibrary(context.applicationContext) }
    val installedModelIds = remember(modelRevision) {
        ModelCatalog.models.filter { modelStore.installed(it.id) }.map { it.id }.toSet()
    }
    val notificationPermission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        scope.launch { snackbar.showSnackbar(if (granted) "Task notifications enabled." else "Notifications remain off.") }
    }
    val setupPrefs = remember(context) {
        context.getSharedPreferences("datacube_model_setup", android.content.Context.MODE_PRIVATE)
    }
    val userSetupKey = "offered_" + authState.user?.id.orEmpty()
    var setupStep by remember(userSetupKey) {
        mutableIntStateOf(if (setupPrefs.getBoolean(userSetupKey, false)) -1 else 0)
    }
    if (setupStep >= 0) {
        val capability = remember(setupStep) {
            if (setupStep == 1) DeviceCapabilityScanner.scan(context) else null
        }
        DataCubeDialog(
            onDismissRequest = {
                setupPrefs.edit().putBoolean(userSetupKey, true).apply()
                setupStep = -1
            },
            title = { Text(if (setupStep == 0) "Set up local models?" else "Your device") },
            text = {
                Text(
                    if (capability == null) "Check memory and free space to recommend a model. No personal files are scanned."
                    else "${capability.ramGb} GB memory · ${capability.freeStorageGb} GB free. Suggested: ${capability.recommendedModel}."
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    if (setupStep == 0) setupStep = 1
                    else {
                        setupPrefs.edit().putBoolean(userSetupKey, true).apply()
                        setupStep = -1
                        navController.navigate(Screen.Models.route)
                    }
                }) { Text(if (setupStep == 0) "Check device" else "View models") }
            },
            dismissButton = {
                TextButton(onClick = {
                    setupPrefs.edit().putBoolean(userSetupKey, true).apply()
                    setupStep = -1
                }) { Text("Not now") }
            }
        )
    }

    // Multi-select document picker. Imports are copied sequentially and scheduled locally.
    val mimeTypes = arrayOf(
        "application/pdf",
        "text/plain",
        "text/markdown"
    )

    val modelBackupLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument(ModelBackupManager.BACKUP_MIME_TYPE)
    ) { destination ->
        if (destination != null) {
            scope.launch {
                runCatching { ModelBackupManager(context).exportBackup(destination) }
                    .onSuccess { summary ->
                        snackbar.showSnackbar(
                            "Backed up ${summary.modelCount} model(s), ${summary.fileCount} file(s)."
                        )
                    }
                    .onFailure { error ->
                        snackbar.showSnackbar(error.message ?: "Could not create the model backup.")
                    }
            }
        }
    }

    val modelRestoreLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { source ->
        if (source != null) offerRestore(source)
    }

    val modelImportPicker = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenMultipleDocuments()
    ) { uris ->
        val target = modelImportTarget
        modelImportTarget = null
        if (target != null && uris.isNotEmpty()) {
            scope.launch {
                try {
                    LocalModelLibrary(context.applicationContext).install(target, uris)
                    modelRevision += 1
                    snackbar.showSnackbar("${target.name} files imported. Runtime activation comes next.")
                } catch (error: Exception) {
                    snackbar.showSnackbar(error.message ?: "Model import failed.")
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

    val navBackStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = navBackStackEntry?.destination?.route
    val isWorkspaceRoute = currentRoute == Screen.Collection.route || currentRoute == Screen.Document.route

    // Nested workspaces consume system back and return to their parent instead of closing the app.
    BackHandler(enabled = isWorkspaceRoute && navController.previousBackStackEntry != null) {
        navController.popBackStack()
    }

    // Keep the top notice OUTSIDE Scaffold's snackbar slot. A fillMaxSize()
    // snackbar there is measured as an entire screen and steals all nav space.
    // A normal-height host above Scaffold reserves only its actual banner height.
    Column(Modifier.fillMaxSize()) {
        SnackbarHost(
            hostState = snackbar,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp)
        )
        Scaffold(modifier = Modifier.weight(1f)) { padding ->
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
                    onNavigateToGist = { navController.navigate(Screen.Discs.route) },
                    onNavigateToChat = { navController.navigate(Screen.Documents.route) },
                    onOpenDocument = { id -> navController.navigate("document/$id") },
                    onSendPromptToDocument = { id, prompt ->
                        navController.navigate("document/$id?prompt=" + Uri.encode(prompt) + "&tab=0")
                    },
                    onNavigateSettings = { navController.navigate(Screen.Settings.route) }
                )
            }
            composable(Screen.Discs.route) {
                DiscsScreen(
                    accountId = requireNotNull(authState.user).id,
                    documents = documents,
                    onBack = { navController.popBackStack() },
                    onOpenDocument = { id -> navController.navigate("document/$id") },
                    onOpenDocuments = { navController.navigate(Screen.Documents.route) }
                )
            }
            composable(Screen.Documents.route) {
                DocumentsScreen(
                    documents = documents,
                    collections = collections,
                    onImport = { multiPicker.launch(mimeTypes) },
                    onNavigateHome = { navController.navigate(Screen.Home.route) },
                    onNavigateSettings = { navController.navigate(Screen.Settings.route) },
                    onNavigateToDiscs = { navController.navigate(Screen.Discs.route) },
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
                    onOpenDocument = { id -> navController.navigate("document/$id") },
                    onOpenCollectionChat = {
                        if (collectionId.isNotBlank()) navController.navigate("collection-chat/$collectionId")
                    }
                )
            }
            composable(Screen.CollectionChat.route) { entry ->
                val collectionId = entry.arguments?.getString("id").orEmpty()
                val collection = collections.firstOrNull { it.id == collectionId }
                val collectionDocumentsFlow = remember(collectionId) {
                    documentsViewModel.observeCollectionDocuments(collectionId)
                }
                val collectionDocs by collectionDocumentsFlow.collectAsStateWithLifecycle(
                    initialValue = emptyList()
                )
                val allowedIds = collectionDocs.map { it.id }.toSet()
                DiscsScreen(
                    accountId = requireNotNull(authState.user).id,
                    documents = documents.filter { it.document.id in allowedIds },
                    onBack = { navController.popBackStack() },
                    onOpenDocument = { id ->
                        if (id in allowedIds) navController.navigate("document/$id")
                    },
                    onOpenDocuments = { navController.navigate("collection/$collectionId") },
                    collectionId = collectionId,
                    collectionName = collection?.name ?: "Collection AU",
                    onOpenModels = { navController.navigate(Screen.Models.route) }
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

                val extractionReady = when (selectedProcessing?.extractionStatus) {
                    LocalJobStatus.COMPLETED, LocalJobStatus.FAILED, LocalJobStatus.CANCELLED -> true
                    else -> !textPreview.isNullOrBlank()
                }
                if (selectedDocument != null && !extractionReady) {
                    DocumentPreparationScreen(
                        documentName = selectedDocument.name,
                        extractionStatus = selectedProcessing?.extractionStatus,
                        extractionProgress = selectedProcessing?.extractionProgress,
                        onBack = { navController.popBackStack() }
                    )
                } else if (selectedDocument != null) {
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
                        onBack = { navController.popBackStack() },
                        onOpenModels = { navController.navigate(Screen.Models.route) }
                    )
                } else {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Text("Document is unavailable. Return to your library and refresh.")
                    }
                }
            }
            composable(Screen.Settings.route) {
                ProfileScreen(
                    user = authState.user,
                    onBack = { navController.popBackStack() },
                    onSignOut = {
                         au.datacube.app.work.AuBackgroundWork.cancelAll()
                         au.datacube.app.ui.common.AuReadAloudSessions.stopAll()
                         au.datacube.app.audio.AuAudioPlayback.stop()
                         DocumentChatSessions.releaseAll()
                         au.datacube.app.audio.PodcastOverviewSession.stopAll()
                         authViewModel.signOut()
                     },
                    onBackupModels = {
                        modelBackupLauncher.launch(
                            "${ModelBackupManager.BACKUP_FILE_PREFIX}-${System.currentTimeMillis()}.zip"
                        )
                    },
                    onRestoreModels = {
                        modelRestoreLauncher.launch(arrayOf(ModelBackupManager.BACKUP_MIME_TYPE, "application/octet-stream", "application/x-zip-compressed"))
                    },
                    themePreference = themePreference,
                    onThemeChange = onThemeChange,
                    onOpenModels = { navController.navigate(Screen.Models.route) },
                    onOpenVault = { navController.navigate(Screen.ModelVault.route) },
                    onOpenSubscription = {
                        val url = BuildConfig.AUTH_WEBSITE_URL.trimEnd('/') + "/dashboard/settings/usage"
                        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                    },
                    onEnableNotifications = {
                        if (android.os.Build.VERSION.SDK_INT >= 33) {
                            notificationPermission.launch(android.Manifest.permission.POST_NOTIFICATIONS)
                        } else {
                            scope.launch { snackbar.showSnackbar("Notifications are controlled in Android settings.") }
                        }
                    }
                )
            }
            composable(Screen.ModelVault.route) {
                ModelVaultScreen(
                    folderRevision = vaultRevision,
                    installedRevision = modelRevision,
                    installed = { id -> modelStore.installed(id) },
                    onChooseFolder = { modelVaultFolderPicker.launch(null) },
                    onRestoreArchive = { uri -> offerRestore(uri) },
                    onOpenArchive = {
                        modelRestoreLauncher.launch(arrayOf(ModelBackupManager.BACKUP_MIME_TYPE, "application/octet-stream", "application/x-zip-compressed"))
                    },
                    onBack = { navController.popBackStack() }
                )
            }
            composable(Screen.Models.route) {
                ModelsScreen(
                    installed = { id -> modelStore.installed(id) },
                    onOpenVault = { navController.navigate(Screen.ModelVault.route) },
                    onChooseFolder = { modelVaultFolderPicker.launch(null) },
                    folderRevision = vaultRevision,
                    onGet = { model ->
                        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(model.sourcePage)))
                    },
                    onImport = { model ->
                        modelImportTarget = model
                        modelImportPicker.launch(arrayOf("*/*"))
                    },
                    onBack = { navController.popBackStack() }
                )
            }
        }
        }
    }
}
